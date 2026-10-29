# TeamReach MCP Server

An MCP (Model Context Protocol) server that exposes a recreational sports group's
[TeamReach](https://www.teamreach.com) workflows as typed tools an AI agent can call: reading and
posting group messages, creating and copying events, booking a recurring week, reporting
participation, and monitoring RSVPs for players who drop out.

It runs a weekday-morning pickleball group of 70+ players. Scheduled Claude Code jobs call the
tools to post a daily court-openings digest, book events three weeks ahead, and alert the
organizer (and, on the day of play, the group) when someone drops.

> **Unofficial API.** TeamReach has no public API. This server calls the same HTTP endpoints the
> TeamReach mobile app uses, authenticated with a session token taken from the app's own
> traffic. It is not affiliated with or endorsed by TeamReach, and it can break whenever the app
> changes.

## Why MCP

The first version was a set of Node scripts that an LLM agent ran through shell commands. It
needed long instruction files just so the model knew how to call each script and parse its
JSON, and it was fragile. MCP collapses that: each operation is a typed tool with a schema, and
the model calls it directly.

## Tools

| Tool | What it does | State |
|---|---|---|
| `teamreach_read_messages` | Fetch recent group chat messages, with comments | - |
| `teamreach_post_message` | Post a message to a group | - |
| `teamreach_check_openings` | Events in the next 7 days, with open spots, waitlist size and how many more players are needed to open another court | - |
| `teamreach_check_rsvps` | Diff current RSVPs for every monitored group against the last snapshot and return dropouts, waitlist promotions and new sign-ups | Supabase |
| `teamreach_notify_drop` | Post a day-of drop announcement for a drop that `check_rsvps` detected | Supabase |
| `teamreach_create_event` | Create an event | - |
| `teamreach_copy_event` | Copy an existing event to a new date and time | - |
| `teamreach_book_weekly` | Create Monday/Wednesday/Friday 6-8am events for a target week (default: three weeks out) | - |
| `teamreach_get_participation` | Play counts per player and active vs. inactive members over the past N months | - |

### RSVP monitoring

`teamreach_check_rsvps` stores a snapshot of each upcoming event's yes-list and waitlist in
Supabase and compares every run against it. Each change is classified (the spot was filled from
the waitlist, filled by a new RSVP, or is still open) and returned once, because notified
dropouts are tracked per event. Snapshots for past events are purged.

Group announcements go through a separate tool, `teamreach_notify_drop`, built so the model
can't post something that didn't happen:

1. **Provenance.** It takes only an `event_id` and `dropped_user_id`, and posts only if
   `check_rsvps` wrote a matching row to the pending-drop ledger. A made-up drop has no row.
2. **Server-side text.** The message is rendered from the ledger row, so the caller can't
   supply or alter the wording.
3. **Policy.** It posts only when the event is less than 24 hours away, recomputed at post time.
4. **Idempotency.** The drop is claimed atomically before posting, so retries and overlapping
   runs can't double-post. A failed post releases the claim.
5. **Allowlist.** It re-checks the group against `TEAMREACH_READABLE_GROUPS`.

Every tool refuses groups that are not in `TEAMREACH_READABLE_GROUPS`.

## Architecture

```
scheduled job (cron)
  └─► claude -p "<fixed prompt>"
        ├─► node bin/mcp-stdio.js ──► TeamReach app API
        │                         └─► Supabase (RSVP snapshots, pending-drop ledger)
        └─► Slack MCP connector  ──► DM to the organizer

optional: Vercel function api/mcp.ts ──► the same tools over HTTP, bearer auth (MCP_SECRET)
```

Both transports register the same tool modules from `src/tools/`. Each module exports a
`register(server)` function. The pure decision logic (change detection, drop rendering, the
24-hour window) lives in `src/lib/rsvp-logic.ts` and is unit tested without network access.

Slack alerts aren't sent by this server. The calling agent sends them through its own Slack
connector, using what `check_rsvps` returns.

## Setup

Requirements: Node 20+ and a Supabase project.

```bash
npm install
cp .env.example .env.local     # fill in credentials and group IDs
npx tsc                        # builds dist/, which the stdio entry point loads
```

Apply the migrations in `supabase/migrations/` (for example with `supabase db push`).

| Variable | Purpose |
|---|---|
| `TEAMREACH_UID`, `TEAMREACH_TOKEN` | TeamReach session credentials. They expire and must be refreshed by hand |
| `TEAMREACH_TIMEZONE` | Time zone sent with requests (default `America/Denver`) |
| `TEAMREACH_READABLE_GROUPS` | Comma-separated allowlist of group IDs |
| `TEAMREACH_MONITORED_GROUPS` | Groups scanned by `teamreach_check_rsvps` |
| `TEAMREACH_BOOKING_GROUP` | Default group for `teamreach_book_weekly` |
| `TEAMREACH_GROUP_ALIASES` | Optional `name=id` pairs, e.g. `morning=123456,test=654321` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | RSVP state storage |
| `MCP_SECRET` | Bearer token for the Vercel HTTP transport only |

### Register with Claude Code (stdio)

```bash
claude mcp add teamreach -- node /path/to/teamreach-mcp/bin/mcp-stdio.js
```

`bin/mcp-stdio.js` loads `.env.local` from the repo root. Re-run `npx tsc` after editing any
`.ts` file. `npm run build` only type-checks and doesn't write `dist/`.

### Deploy the HTTP transport (optional)

The repo deploys to Vercel as-is (`vercel.json` routes `/mcp` to `api/mcp.ts`). Set the same
environment variables in the Vercel project, then connect with
`Authorization: Bearer $MCP_SECRET`.

## Tests

```bash
npx tsc && node rsvp-logic.test.mjs
```

The tests cover change detection, waitlist and fresh-fill classification, ledger mapping, drop
message rendering and the 24-hour posting window.

## Layout

```
bin/mcp-stdio.js        stdio entry point (local agents, cron)
api/mcp.ts              HTTP entry point (Vercel function, bearer auth)
src/lib/teamreach-api.ts  TeamReach HTTP client, group allowlist and aliases
src/lib/rsvp-logic.ts   pure RSVP diffing and drop-post policy
src/lib/supabase.ts     snapshot and pending-drop persistence
src/tools/              one file per MCP tool
supabase/migrations/    database schema
rsvp-logic.test.mjs     unit tests
```
