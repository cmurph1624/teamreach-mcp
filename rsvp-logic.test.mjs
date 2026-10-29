// Unit tests for the pure RSVP change-evaluation logic.
// Run: node rsvp-logic.test.mjs

import {
  evaluateEventChanges,
  pendingDropFromChange,
  renderDropPost,
  evaluateNotifyDrop,
} from "./dist/src/lib/rsvp-logic.js";

const PASS = [];
const FAIL = [];
function check(name, ok, detail = "") {
  (ok ? PASS : FAIL).push(`${name}${detail ? " — " + detail : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const tom = { userId: "1", firstName: "Tom", lastName: "M" };
const steve = { userId: "2", firstName: "Steve", lastName: "L" };
const ann = { userId: "3", firstName: "Ann", lastName: "B" };
const ben = { userId: "4", firstName: "Ben", lastName: "C" };

const baseEvent = {
  eventId: "E1",
  groupId: "G1",
  title: "Wed",
  eventTime: "2026-05-20 06:00:00",
  maxParticipants: 8,
};

// 1. No drop, just a new RSVP into an open slot — no change row produced.
{
  const res = evaluateEventChanges({
    event: baseEvent,
    hoursUntilEvent: 16,
    prev: { yes_users: [ann], waitlist_users: [], notified_dropouts: [], group_posts_sent: [] },
    current: { yesUsers: [ann, ben], waitlistUsers: [] },
  });
  check("pure RSVP produces no changes", res.changes.length === 0, JSON.stringify(res.changes));
}

// 2. Drop with open spots remaining — spotFilled false, openSpots reflects vacancy.
{
  const res = evaluateEventChanges({
    event: baseEvent,
    hoursUntilEvent: 10,
    prev: { yes_users: [tom, ann, ben], waitlist_users: [], notified_dropouts: [], group_posts_sent: [] },
    current: { yesUsers: [ann, ben], waitlistUsers: [] },
  });
  const c = res.changes[0];
  check("open-spot drop: one change", res.changes.length === 1);
  check("open-spot drop: spotFilled=false", c && c.spotFilled === false);
  check("open-spot drop: fromWaitlist=false", c && c.fromWaitlist === false);
  check("open-spot drop: openSpots=6", c && c.openSpots === 6, `got ${c && c.openSpots}`);
}

// 3. Drop with waitlist promotion — newUser was on prev waitlist.
{
  const res = evaluateEventChanges({
    event: baseEvent,
    hoursUntilEvent: 5,
    prev: {
      yes_users: [tom, ann, ben, steve, ann, ann, ann, ann].slice(0, 8),
      waitlist_users: [{ userId: "9", firstName: "Wait", lastName: "Person" }],
      notified_dropouts: [],
      group_posts_sent: [],
    },
    current: {
      yesUsers: [ann, ben, steve, ann, ann, ann, ann, { userId: "9", firstName: "Wait", lastName: "Person" }],
      waitlistUsers: [],
    },
  });
  const c = res.changes[0];
  check("waitlist promo: one change", res.changes.length === 1);
  check("waitlist promo: spotFilled=true", c && c.spotFilled === true);
  check("waitlist promo: fromWaitlist=true", c && c.fromWaitlist === true);
  check("waitlist promo: openSpots=0", c && c.openSpots === 0);
}

// 4. Drop with fresh new RSVP fill — newUser was NOT on prev waitlist.
{
  const res = evaluateEventChanges({
    event: baseEvent,
    hoursUntilEvent: 16,
    prev: {
      yes_users: [tom, ann, ben, steve, ann, ann, ann, ann].slice(0, 8),
      waitlist_users: [],
      notified_dropouts: [],
      group_posts_sent: [],
    },
    current: {
      yesUsers: [ann, ben, steve, ann, ann, ann, ann, { userId: "99", firstName: "Fresh", lastName: "Sub" }],
      waitlistUsers: [],
    },
  });
  const c = res.changes[0];
  check("fresh fill: spotFilled=true", c && c.spotFilled === true);
  check("fresh fill: fromWaitlist=false", c && c.fromWaitlist === false);
  check("fresh fill: openSpots=0", c && c.openSpots === 0);
}

// 5. Already notified — no duplicate change.
{
  const res = evaluateEventChanges({
    event: baseEvent,
    hoursUntilEvent: 10,
    prev: { yes_users: [tom, ann], waitlist_users: [], notified_dropouts: [tom.userId], group_posts_sent: [] },
    current: { yesUsers: [ann], waitlistUsers: [] },
  });
  check("dedupe: no change for already-notified drop", res.changes.length === 0);
}

// 6. State carries forward — notified_dropouts and group_posts_sent updated correctly.
{
  const res = evaluateEventChanges({
    event: baseEvent,
    hoursUntilEvent: 10,
    prev: { yes_users: [tom, ann], waitlist_users: [], notified_dropouts: [], group_posts_sent: [] },
    current: { yesUsers: [ann], waitlistUsers: [] },
  });
  check("state: dropout id recorded", res.nextState.notified_dropouts.includes(tom.userId));
  check("state: group post recorded (<24h)", res.nextState.group_posts_sent.includes(`dropout:${tom.userId}`));
}

// 7. >24h drop — change row still produced but group post NOT pre-recorded.
{
  const res = evaluateEventChanges({
    event: baseEvent,
    hoursUntilEvent: 48,
    prev: { yes_users: [tom, ann], waitlist_users: [], notified_dropouts: [], group_posts_sent: [] },
    current: { yesUsers: [ann], waitlistUsers: [] },
  });
  check("far-future drop: change produced", res.changes.length === 1);
  check("far-future drop: group post NOT recorded", !res.nextState.group_posts_sent.includes(`dropout:${tom.userId}`));
}

// --- notify_drop ledger logic ---------------------------------------------

const sampleChange = {
  groupId: "100001",
  eventId: "E9",
  eventTitle: "Friday",
  eventTime: "2026-05-29 06:00:00",
  hoursUntilEvent: 20,
  droppedUser: { userId: "100", firstName: "Alex", lastName: "Rivera" },
  spotFilled: false,
  newUser: null,
  fromWaitlist: false,
  openSpots: 1,
  alreadyPostedToGroup: false,
};

// 8. pendingDropFromChange copies references verbatim; no fabricated content.
{
  const d = pendingDropFromChange(sampleChange);
  check("ledger map: event_id", d.event_id === "E9");
  check("ledger map: dropped_user_id from droppedUser", d.dropped_user_id === "100");
  check("ledger map: group_id verbatim", d.group_id === "100001");
  check("ledger map: title verbatim", d.event_title === "Friday");
  check("ledger map: names verbatim", d.dropped_first === "Alex" && d.dropped_last === "Rivera");
  check("ledger map: open-spot newUser null", d.new_user_name === null);
}

// 9. pendingDropFromChange composes newUser name when a spot was filled.
{
  const filled = {
    ...sampleChange,
    spotFilled: true,
    fromWaitlist: true,
    newUser: { userId: "200", firstName: "Sam", lastName: "Patel" },
    openSpots: 0,
  };
  const d = pendingDropFromChange(filled);
  check("ledger map: new_user_name composed", d.new_user_name === "Sam Patel", d.new_user_name);
  check("ledger map: from_waitlist carried", d.from_waitlist === true);
}

// 10. renderDropPost — open spot wording (no apostrophes in authored prose).
{
  const text = renderDropPost(pendingDropFromChange(sampleChange));
  check(
    "render: open spot",
    text === "Alex Rivera dropped from Friday. Spot is open — first to RSVP gets in.",
    text
  );
  check("render: no straight apostrophe", !text.includes("'"));
  check("render: no smart apostrophe", !text.includes("’"));
}

// 11. renderDropPost — fresh fill vs waitlist promotion.
{
  const fresh = renderDropPost({
    event_id: "E", dropped_user_id: "1", group_id: "100001", event_title: "Wednesday",
    event_time: "x", dropped_first: "Jordan", dropped_last: "Kim",
    spot_filled: true, new_user_name: "Steve Lopez", from_waitlist: false, open_spots: 0,
  });
  check("render: fresh fill", fresh === "Jordan Kim dropped from Wednesday. Spot filled by Steve Lopez.", fresh);

  const wait = renderDropPost({
    event_id: "E", dropped_user_id: "1", group_id: "100001", event_title: "Wednesday",
    event_time: "x", dropped_first: "Jordan", dropped_last: "Kim",
    spot_filled: true, new_user_name: "Wait Person", from_waitlist: true, open_spots: 0,
  });
  check("render: waitlist promo", wait === "Jordan Kim dropped from Wednesday. Spot filled from the waitlist by Wait Person.", wait);
}

// 12. renderDropPost — defensive: spot_filled true but no name falls back to open.
{
  const text = renderDropPost({
    event_id: "E", dropped_user_id: "1", group_id: "100001", event_title: "Friday",
    event_time: "x", dropped_first: "Alex", dropped_last: "Rivera",
    spot_filled: true, new_user_name: null, from_waitlist: false, open_spots: 1,
  });
  check("render: filled-but-no-name falls back to open", text.endsWith("Spot is open — first to RSVP gets in."), text);
}

// 13. evaluateNotifyDrop — time window gate (deterministic via explicit nowMs).
{
  const eventMs = Date.parse("2026-05-29T06:00:00Z");
  const drop = {
    event_id: "E9", dropped_user_id: "100", group_id: "100001", event_title: "Friday",
    event_time: "2026-05-29T06:00:00Z", dropped_first: "Alex", dropped_last: "Rivera",
    spot_filled: false, new_user_name: null, from_waitlist: false, open_spots: 1,
    posted_at: null,
  };

  const inWindow = evaluateNotifyDrop(drop, eventMs - 10 * 3600 * 1000);
  check("notify: 10h out -> post", inWindow.shouldPost === true);
  check("notify: 10h out -> renders text", inWindow.text && inWindow.text.startsWith("Alex Rivera dropped"));

  const tooFar = evaluateNotifyDrop(drop, eventMs - 25 * 3600 * 1000);
  check("notify: 25h out -> no post", tooFar.shouldPost === false);
  check("notify: 25h out -> reason mentions 24h", tooFar.reason.includes(">=24h"));

  const past = evaluateNotifyDrop(drop, eventMs + 3600 * 1000);
  check("notify: past event -> no post", past.shouldPost === false);

  const posted = evaluateNotifyDrop({ ...drop, posted_at: "2026-05-28T20:00:00Z" }, eventMs - 10 * 3600 * 1000);
  check("notify: already posted -> no post", posted.shouldPost === false);
  check("notify: already posted -> no text", posted.text === undefined);
}

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) process.exit(1);
