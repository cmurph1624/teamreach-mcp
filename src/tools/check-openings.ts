import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  assertGroupAllowed,
  fetchEvents,
  fetchRsvps,
  resolveGroupId,
  type TeamReachEvent,
} from "../lib/teamreach-api.js";

interface OpeningsResult {
  eventId: string;
  title: string;
  eventTimeLocal: string;
  status: "open" | "full_no_waitlist" | "full_court_ready" | "full_waitlist";
  maxParticipants: number;
  yesCount: number;
  openSpots: number;
  waitlistCount: number;
  neededForNewCourt: number | null;
}

function computeStatus(
  yesCount: number,
  maxParticipants: number,
  waitlistCount: number
) {
  if (yesCount < maxParticipants) {
    return { status: "open" as const, openSpots: maxParticipants - yesCount, neededForNewCourt: null };
  }
  if (waitlistCount === 0) {
    return { status: "full_no_waitlist" as const, openSpots: 0, neededForNewCourt: null };
  }
  if (waitlistCount % 4 === 0) {
    return { status: "full_court_ready" as const, openSpots: 0, neededForNewCourt: 0 };
  }
  return {
    status: "full_waitlist" as const,
    openSpots: 0,
    neededForNewCourt: 4 - (waitlistCount % 4),
  };
}

export function register(server: McpServer) {
  server.tool(
    "teamreach_check_openings",
    "Check court availability for all events in the next 7 days. Returns open spots, waitlist status, and court-ready indicators.",
    {
      group_id: z.string().describe("TeamReach group ID, or an alias from TEAMREACH_GROUP_ALIASES"),
    },
    async ({ group_id: raw_group_id }) => {
      const group_id = resolveGroupId(raw_group_id);
      assertGroupAllowed(group_id);

      const now = new Date();
      const cutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const rawEvents = await fetchEvents(group_id);
      const results: OpeningsResult[] = [];

      for (const ev of rawEvents) {
        if (ev.Inactive === "1" || ev.Inactive === 1) continue;
        if (ev.IsParticipantLimitSet !== "1" && ev.IsParticipantLimitSet !== 1) continue;

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

        const maxParticipants = parseInt(ev.MaximumParticipants || "0", 10);
        const rsvps = await fetchRsvps(group_id, eventId);
        const { status, openSpots, neededForNewCourt } = computeStatus(
          rsvps.yesUsers.length,
          maxParticipants,
          rsvps.waitlistUsers.length
        );

        results.push({
          eventId,
          title,
          eventTimeLocal: eventTime,
          status,
          maxParticipants,
          yesCount: rsvps.yesUsers.length,
          openSpots,
          waitlistCount: rsvps.waitlistUsers.length,
          neededForNewCourt,
        });
      }

      results.sort(
        (a, b) =>
          new Date(a.eventTimeLocal).getTime() -
          new Date(b.eventTimeLocal).getTime()
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { groupId: group_id, generatedAt: now.toISOString(), events: results },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
