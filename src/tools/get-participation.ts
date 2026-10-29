import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  assertGroupAllowed,
  fetchEvents,
  fetchRsvps,
  fetchMembers,
  resolveGroupId,
} from "../lib/teamreach-api.js";

export function register(server: McpServer) {
  server.tool(
    "teamreach_get_participation",
    "Generate a participation report for a group over the past N months. Shows play counts per player and active vs. inactive members.",
    {
      group_id: z.string().describe("TeamReach group ID, or an alias from TEAMREACH_GROUP_ALIASES"),
      months: z
        .number()
        .optional()
        .default(1)
        .describe("How many months back to analyze (default: 1)"),
    },
    async ({ group_id: raw_group_id, months }) => {
      const group_id = resolveGroupId(raw_group_id);
      assertGroupAllowed(group_id);

      const now = new Date();
      const windowStart = new Date(
        now.getTime() - months * 30 * 24 * 60 * 60 * 1000
      );

      const members = await fetchMembers(group_id);
      const memberMap: Record<string, string> = {};
      for (const m of members) {
        const id = String(m.UserId || m.userId || "");
        if (id)
          memberMap[id] =
            `${m.FirstName || ""} ${m.LastName || ""}`.trim() || `User ${id}`;
      }

      const rawEvents = await fetchEvents(group_id);
      const pastEvents: Array<{
        eventId: string;
        title: string;
        eventDate: Date;
      }> = [];

      for (const ev of rawEvents) {
        if (ev.Inactive === "1" || ev.Inactive === 1) continue;
        const eventId = String(ev.EventId || ev.eventId || "");
        const title = String(ev.Title || ev.title || "Untitled");
        const ts = ev.EventTimeStamp || ev.eventTimestamp || null;
        const eventTime = String(ev.EventTime || ev.eventTime || "");
        if (!eventId) continue;

        const eventDate = ts
          ? new Date(parseInt(String(ts), 10) * 1000)
          : new Date(eventTime);
        if (isNaN(eventDate.getTime())) continue;
        if (eventDate >= now || eventDate < windowStart) continue;

        pastEvents.push({ eventId, title, eventDate });
      }

      pastEvents.sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());

      const participation: Record<
        string,
        { name: string; count: number }
      > = {};

      for (const { eventId } of pastEvents) {
        const rsvps = await fetchRsvps(group_id, eventId);
        for (const u of rsvps.yesUsers) {
          if (!u.userId) continue;
          const name =
            `${u.firstName} ${u.lastName}`.trim() ||
            memberMap[u.userId] ||
            `User ${u.userId}`;
          if (!participation[u.userId]) {
            participation[u.userId] = { name, count: 0 };
          }
          participation[u.userId].count++;
        }
      }

      const sorted = Object.entries(participation).sort(
        ([, a], [, b]) => b.count - a.count
      );

      const activeIds = new Set(Object.keys(participation));
      const inactiveMembers = members
        .filter((m) => !activeIds.has(String(m.UserId || m.userId || "")))
        .map(
          (m) => `${m.FirstName || ""} ${m.LastName || ""}`.trim() || "Unknown"
        );

      const fmt = (d: Date) =>
        d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

      let report = `Participation Report (${fmt(windowStart)} - ${fmt(now)})\n`;
      report += `Group: ${group_id} | Events analyzed: ${pastEvents.length}\n\n`;
      report += `--- Play Count (most active first) ---\n`;
      sorted.forEach(([, { name, count }], i) => {
        report += `  ${i + 1}. ${name} — ${count} play${count !== 1 ? "s" : ""}\n`;
      });
      report += `\n--- Inactive (no plays in past ${months} months): ${inactiveMembers.length} ---\n`;
      inactiveMembers.forEach((name) => {
        report += `  ${name}\n`;
      });
      report += `\nTotal members: ${members.length} | Active: ${sorted.length} | Inactive: ${inactiveMembers.length}`;

      return {
        content: [{ type: "text", text: report }],
      };
    }
  );
}
