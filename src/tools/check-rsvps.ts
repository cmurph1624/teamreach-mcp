import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  fetchEvents,
  fetchRsvps,
  getMonitoredGroups,
} from "../lib/teamreach-api.js";
import {
  loadRsvpState,
  saveRsvpState,
  savePendingDrop,
  purgeExpiredRsvpState,
} from "../lib/supabase.js";
import {
  evaluateEventChanges,
  pendingDropFromChange,
  type RsvpChange,
} from "../lib/rsvp-logic.js";

export function register(server: McpServer) {
  server.tool(
    "teamreach_check_rsvps",
    "Check all monitored groups for RSVP dropouts. Compares current RSVPs against saved state and returns any changes. Used by the RSVP monitor cron.",
    {},
    async () => {
      const groups = getMonitoredGroups();
      if (groups.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No monitored groups configured in TEAMREACH_MONITORED_GROUPS",
            },
          ],
        };
      }

      const now = new Date();
      const cutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const changes: RsvpChange[] = [];

      for (const gid of groups) {
        let rawEvents;
        try {
          rawEvents = await fetchEvents(gid);
        } catch (err) {
          continue;
        }

        for (const ev of rawEvents) {
          if (ev.Inactive === "1" || ev.Inactive === 1) continue;

          const eventId = String(ev.EventId || ev.eventId || "");
          const title = String(ev.Title || ev.title || "Untitled Event");
          const eventTime = String(ev.EventTime || ev.eventTime || "");
          const ts = ev.EventTimeStamp || ev.eventTimestamp || null;

          if (!eventId || !eventTime) continue;

          const eventDate = ts
            ? new Date(parseInt(String(ts), 10) * 1000)
            : new Date(eventTime);
          if (isNaN(eventDate.getTime())) continue;
          if (eventDate <= now || eventDate > cutoff) continue;

          const maxParticipants =
            ev.IsParticipantLimitSet === "1" || ev.IsParticipantLimitSet === 1
              ? parseInt(ev.MaximumParticipants || "0", 10)
              : null;

          const rsvps = await fetchRsvps(gid, eventId);
          const prev = await loadRsvpState(eventId);

          const hoursUntilEvent =
            (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60);

          const { changes: eventChanges, nextState } = evaluateEventChanges({
            event: { eventId, groupId: gid, title, eventTime, maxParticipants },
            hoursUntilEvent,
            prev,
            current: { yesUsers: rsvps.yesUsers, waitlistUsers: rsvps.waitlistUsers },
          });

          changes.push(...eventChanges);

          // Persist each detected drop to the ledger so teamreach_notify_drop can
          // only ever post a drop the detector actually found (provenance token).
          // Non-fatal: the ledger is additive, so a write failure must not break
          // detection or the Slack DM path — notify_drop just safely declines to
          // post a drop with no ledger row.
          for (const change of eventChanges) {
            try {
              await savePendingDrop(pendingDropFromChange(change));
            } catch (err) {
              console.error(
                `Failed to write pending-drop ledger for ${change.eventId}/${change.droppedUser.userId}:`,
                err
              );
            }
          }

          await saveRsvpState({
            event_id: eventId,
            group_id: gid,
            title,
            event_time: eventTime,
            max_participants: maxParticipants,
            yes_users: rsvps.yesUsers,
            waitlist_users: rsvps.waitlistUsers,
            notified_dropouts: nextState.notified_dropouts,
            group_posts_sent: nextState.group_posts_sent,
            updated_at: now.toISOString(),
          });
        }
      }

      await purgeExpiredRsvpState();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ changes }, null, 2),
          },
        ],
      };
    }
  );
}
