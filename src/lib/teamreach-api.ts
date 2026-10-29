const BASE_URL = "https://appserv.teamreach.com/369";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": "TeamReach/9.8 CFNetwork/3860.500.112 Darwin/25.4.0",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

function getCredentials() {
  const uid = process.env.TEAMREACH_UID;
  const token = process.env.TEAMREACH_TOKEN;
  const tz = process.env.TEAMREACH_TIMEZONE || "America/Denver";

  if (!uid || !token) {
    throw new Error(
      "Missing TEAMREACH_UID or TEAMREACH_TOKEN environment variables"
    );
  }

  return { uid, token, tz };
}

// Optional friendly names for group IDs, e.g. "morning=123456,test=654321".
function parseGroupAliases(raw: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [name, gid] = pair.split("=").map((s) => s.trim());
    if (name && gid) aliases[name.toLowerCase()] = gid;
  }
  return aliases;
}

const GROUP_ALIASES = parseGroupAliases(process.env.TEAMREACH_GROUP_ALIASES || "");

export function resolveGroupId(input: string): string {
  const lower = input.toLowerCase().trim();
  return GROUP_ALIASES[lower] || input;
}

function getAllowedGroups(): Set<string> {
  const raw = process.env.TEAMREACH_READABLE_GROUPS || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function getMonitoredGroups(): string[] {
  const raw = process.env.TEAMREACH_MONITORED_GROUPS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function assertGroupAllowed(gid: string): void {
  const allowed = getAllowedGroups();
  if (!allowed.has(gid)) {
    throw new Error(
      `Access denied: group ${gid} is not in TEAMREACH_READABLE_GROUPS (${[...allowed].join(", ")})`
    );
  }
}

async function post(endpoint: string, params: Record<string, string>) {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: HEADERS,
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`TeamReach API ${endpoint} HTTP ${res.status}`);
  return res.json();
}

export async function fetchEvents(gid: string) {
  const { uid, token, tz } = getCredentials();
  const data = await post("group_events.php", {
    i: "teamreach",
    uid,
    gid,
    eid: "0",
    tz,
    ts: "0",
    rmets: "",
    token,
  });
  return (data.events || data.Events || []) as TeamReachEvent[];
}

export async function fetchRsvps(gid: string, eid: string) {
  const { uid, token } = getCredentials();
  const data = await post("group_events_results.php", {
    i: "teamreach",
    uid,
    gid,
    eid,
    token,
  });
  return {
    yesUsers: ((data.YesData && data.YesData.userinfo) || []).map(
      normalizeUser
    ),
    waitlistUsers: ((data.WaitData && data.WaitData.userinfo) || []).map(
      normalizeUser
    ),
  };
}

export async function fetchMessages(
  gid: string,
  numRecords = 20,
  sinceDate = "2000-01-01 00:00:00"
) {
  const { uid, token, tz } = getCredentials();
  const data = await post("group_messages.php", {
    i: "teamreach",
    uid,
    gid,
    mon: sinceDate,
    tz,
    nords: String(numRecords),
    pn: "0",
    trc: "0",
    token,
  });
  return (data.messages || []) as TeamReachMessage[];
}

export async function postMessage(gid: string, message: string) {
  const { uid, token, tz } = getCredentials();
  const params = new URLSearchParams({
    i: "teamreach",
    uid,
    gid,
    tz,
    iso: "0",
    idm: "0",
    mat: "a",
    ms: message,
    st: "",
    imp: "0",
    token,
    msid: "0",
  });
  const res = await fetch(
    `${BASE_URL}/group_message_create.php?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "User-Agent": HEADERS["User-Agent"],
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Length": "0",
      },
    }
  );
  const data = await res.json();
  if (!res.ok || data.rc !== 0) {
    throw new Error(`Post failed (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  return { messageId: data.msid as string };
}

export async function createEvent(opts: {
  gid: string;
  title: string;
  startDatetime: string;
  endDatetime: string;
  maxParticipants?: number;
  location?: string;
  details?: string;
}) {
  const { uid, token, tz } = getCredentials();
  const details =
    opts.details ??
    "1. Be on time. Do not be late.\n2. No-shows. Life happens — if you can not make it, post in TeamReach as soon as possible.\n3. Never target the weaker player. This is a practice group, not a tournament. Everyone deserves the chance to develop their games\n4. Last game rule. If your court is the last game still going, scoring switches to rally scoring — first to 11 wins.";

  const formData = new FormData();
  const fields: Record<string, string> = {
    action: "create",
    uid,
    gid: opts.gid,
    i: "teamreach",
    token,
    t: opts.title,
    et: opts.startDatetime,
    eet: opts.endDatetime,
    ut: opts.endDatetime,
    tz,
    dtz: tz,
    dt: "0",
    status: "0",
    rt: "None",
    maxpart: String(opts.maxParticipants ?? 12),
    mapt: "roadmap",
    ifo: "1",
    iwa: "1",
    ias: "0",
    iad: "0",
    irs: "0",
    ipl: "1",
  };
  if (opts.location) fields.l = opts.location;
  // `ed` gets an extra urldecode on the TeamReach server (verified empirically
  // in a test group); sending raw text renders spaces as `+` glyphs. Other
  // fields like `t` and `l` are NOT double-decoded, so they stay raw.
  if (details) fields.ed = encodeURIComponent(details);

  for (const [k, v] of Object.entries(fields)) formData.append(k, v);

  const res = await fetch(`${BASE_URL}/group_events_create.php`, {
    method: "POST",
    headers: {
      "User-Agent": HEADERS["User-Agent"],
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
    body: formData,
  });
  if (!res.ok) throw new Error(`createEvent HTTP ${res.status}`);
  const data = await res.json();
  if (data.rc !== 0) {
    throw new Error(`Event creation failed: ${JSON.stringify(data)}`);
  }
  return { eventId: data.eid as string };
}

export async function fetchMembers(gid: string) {
  const { uid, token, tz } = getCredentials();
  const data = await post("group_members.php", {
    i: "teamreach",
    uid,
    gid,
    t: "0",
    tz,
    ts: "",
    sorting: "fl",
    token,
  });
  return ((data.members || []) as TeamReachMember[]).filter(
    (m) => m.Inactive !== "1" && m.Inactive !== 1
  );
}

export { getMonitoredGroups, GROUP_ALIASES };

// --- Types ---

function normalizeUser(u: Record<string, unknown>): TeamReachUser {
  return {
    userId: String(u.UserId || u.userId || ""),
    firstName: String(u.FirstName || u.firstName || ""),
    lastName: String(u.LastName || u.lastName || ""),
  };
}

export interface TeamReachUser {
  userId: string;
  firstName: string;
  lastName: string;
}

export interface TeamReachEvent {
  EventId?: string;
  eventId?: string;
  Title?: string;
  title?: string;
  EventTime?: string;
  eventTime?: string;
  EventTimeStamp?: string | number;
  eventTimestamp?: string | number;
  Inactive?: string | number;
  IsParticipantLimitSet?: string | number;
  MaximumParticipants?: string;
  Location?: string;
  location?: string;
  EventDetails?: string;
  eventDetails?: string;
  IsForecastOn?: number | boolean;
}

export interface TeamReachMessage {
  FirstName: string;
  LastName: string;
  CreatedOn: string;
  Message: string;
  grpmsgcomments?: Array<{
    FirstName: string;
    LastName: string;
    DisplayCreatedOn?: string;
    CreatedOn?: string;
    Comment: string;
  }>;
}

export interface TeamReachMember {
  UserId?: string;
  userId?: string;
  FirstName?: string;
  LastName?: string;
  Inactive?: string | number;
}
