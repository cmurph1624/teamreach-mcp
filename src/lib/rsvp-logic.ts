import type { TeamReachUser } from "./teamreach-api.js";

export interface RsvpChange {
  groupId: string;
  eventId: string;
  eventTitle: string;
  eventTime: string;
  hoursUntilEvent: number;
  droppedUser: TeamReachUser;
  spotFilled: boolean;
  newUser: TeamReachUser | null;
  fromWaitlist: boolean;
  openSpots: number | null;
  alreadyPostedToGroup: boolean;
}

export interface EvaluateInput {
  event: {
    eventId: string;
    groupId: string;
    title: string;
    eventTime: string;
    maxParticipants: number | null;
  };
  hoursUntilEvent: number;
  prev: {
    yes_users: TeamReachUser[];
    waitlist_users: TeamReachUser[];
    notified_dropouts: string[];
    group_posts_sent: string[];
  } | null;
  current: {
    yesUsers: TeamReachUser[];
    waitlistUsers: TeamReachUser[];
  };
}

export interface EvaluateOutput {
  changes: RsvpChange[];
  nextState: {
    notified_dropouts: string[];
    group_posts_sent: string[];
  };
}

export function evaluateEventChanges(input: EvaluateInput): EvaluateOutput {
  const { event, hoursUntilEvent, prev, current } = input;

  const prevYes = prev?.yes_users || [];
  const prevWaitlistIds = new Set((prev?.waitlist_users || []).map((u) => u.userId));
  const curYesIds = new Set(current.yesUsers.map((u) => u.userId));
  const prevYesIds = new Set(prevYes.map((u) => u.userId));

  const droppedUsers = prevYes.filter((u) => !curYesIds.has(u.userId));
  const addedUsers = current.yesUsers.filter((u) => !prevYesIds.has(u.userId));

  const notifiedDropouts = [...(prev?.notified_dropouts || [])];
  const groupPostsSent = [...(prev?.group_posts_sent || [])];
  const changes: RsvpChange[] = [];

  const max = event.maxParticipants;
  const openSpots = max !== null ? Math.max(0, max - current.yesUsers.length) : null;

  // Pair drops with adds in arrival order so each "filled" attribution lines up
  // with a real new arrival. Excess drops past addedUsers.length get spotFilled=false.
  let addCursor = 0;

  for (const droppedUser of droppedUsers) {
    if (notifiedDropouts.includes(droppedUser.userId)) continue;

    const newUser = addCursor < addedUsers.length ? addedUsers[addCursor] : null;
    if (newUser) addCursor++;

    const spotFilled = newUser !== null;
    const fromWaitlist = newUser !== null && prevWaitlistIds.has(newUser.userId);
    const groupPostKey = `dropout:${droppedUser.userId}`;
    const alreadyPostedToGroup = groupPostsSent.includes(groupPostKey);

    changes.push({
      groupId: event.groupId,
      eventId: event.eventId,
      eventTitle: event.title,
      eventTime: event.eventTime,
      hoursUntilEvent: Math.round(hoursUntilEvent * 10) / 10,
      droppedUser,
      spotFilled,
      newUser,
      fromWaitlist,
      openSpots,
      alreadyPostedToGroup,
    });

    notifiedDropouts.push(droppedUser.userId);
    if (hoursUntilEvent < 24 && !alreadyPostedToGroup) {
      groupPostsSent.push(groupPostKey);
    }
  }

  return {
    changes,
    nextState: { notified_dropouts: notifiedDropouts, group_posts_sent: groupPostsSent },
  };
}

// --- Drop ledger: the trust token for teamreach_notify_drop ---
//
// check_rsvps writes one PendingDrop per real drop it detects. notify_drop only
// ever acts on a row that already exists here, so the LLM cannot post a drop it
// was not handed — it passes references (event_id + dropped_user_id), never prose.

export interface PendingDrop {
  event_id: string;
  dropped_user_id: string;
  group_id: string;
  event_title: string;
  event_time: string;
  dropped_first: string;
  dropped_last: string;
  spot_filled: boolean;
  new_user_name: string | null;
  from_waitlist: boolean;
  open_spots: number | null;
}

// Map a detected change into a ledger row. Pure so it is unit-testable and so the
// names/title are copied verbatim from the API payload, never re-typed by a model.
export function pendingDropFromChange(c: RsvpChange): PendingDrop {
  return {
    event_id: c.eventId,
    dropped_user_id: c.droppedUser.userId,
    group_id: c.groupId,
    event_title: c.eventTitle,
    event_time: c.eventTime,
    dropped_first: c.droppedUser.firstName,
    dropped_last: c.droppedUser.lastName,
    spot_filled: c.spotFilled,
    new_user_name: c.newUser
      ? `${c.newUser.firstName} ${c.newUser.lastName}`
      : null,
    from_waitlist: c.fromWaitlist,
    open_spots: c.openSpots,
  };
}

// Render the group post from the ledger row. The only free-form strings are names
// and the event title, taken verbatim from the row (i.e. from the TeamReach API).
// Prose authored here is apostrophe-free by the pipeline's hard rule.
export function renderDropPost(d: PendingDrop): string {
  const who = `${d.dropped_first} ${d.dropped_last}`.trim();
  if (d.from_waitlist && d.new_user_name) {
    return `${who} dropped from ${d.event_title}. Spot filled from the waitlist by ${d.new_user_name}.`;
  }
  if (d.spot_filled && d.new_user_name) {
    return `${who} dropped from ${d.event_title}. Spot filled by ${d.new_user_name}.`;
  }
  return `${who} dropped from ${d.event_title}. Spot is open — first to RSVP gets in.`;
}

export interface NotifyDecision {
  shouldPost: boolean;
  reason: string;
  text?: string;
}

// Pure policy gate for notify_drop: given a ledger row and the current time, decide
// whether a group post is warranted. Provenance (row exists), the group allowlist,
// and idempotency are enforced separately in the tool — this covers the time window
// and renders the text. Group posts are for drops inside the 24h day-of window only.
export function evaluateNotifyDrop(
  drop: PendingDrop & { posted_at?: string | null },
  nowMs: number
): NotifyDecision {
  if (drop.posted_at) {
    return { shouldPost: false, reason: `Already posted at ${drop.posted_at}.` };
  }
  const eventMs = new Date(drop.event_time).getTime();
  if (Number.isNaN(eventMs)) {
    return { shouldPost: false, reason: `Unparseable event_time "${drop.event_time}".` };
  }
  const hoursUntil = (eventMs - nowMs) / (1000 * 60 * 60);
  if (hoursUntil <= 0) {
    return { shouldPost: false, reason: "Event already started; not posting." };
  }
  if (hoursUntil >= 24) {
    return {
      shouldPost: false,
      reason: `Event is ${hoursUntil.toFixed(1)}h out (>=24h); group post not warranted.`,
    };
  }
  return {
    shouldPost: true,
    reason: `Event ${hoursUntil.toFixed(1)}h out; posting.`,
    text: renderDropPost(drop),
  };
}
