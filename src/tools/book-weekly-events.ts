import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertGroupAllowed, createEvent, resolveGroupId } from "../lib/teamreach-api.js";

function getBookingGroup(override?: string): string {
  if (override) {
    const gid = resolveGroupId(override);
    assertGroupAllowed(gid);
    return gid;
  }
  const gid = process.env.TEAMREACH_BOOKING_GROUP;
  if (!gid) throw new Error("Missing TEAMREACH_BOOKING_GROUP env var");
  return gid;
}

function getTargetMonday(explicitDate?: string): Date {
  if (explicitDate) {
    const [year, month, day] = explicitDate.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    if (isNaN(d.getTime())) throw new Error(`Invalid date: ${explicitDate}`);
    if (d.getDay() !== 1) throw new Error(`${explicitDate} is not a Monday`);
    return d;
  }

  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const target = new Date(today);
  target.setDate(today.getDate() + daysUntilNextMonday + 21);
  return target;
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function register(server: McpServer) {
  server.tool(
    "teamreach_book_weekly",
    "Create Mon/Wed/Fri pickleball events (6-8am) for a target week. If no date given, books 3 weeks from next Monday. Only use when explicitly instructed.",
    {
      monday_date: z
        .string()
        .optional()
        .describe(
          "A Monday date in YYYY-MM-DD format. Omit to auto-calculate 3 weeks out."
        ),
      group_id: z
        .string()
        .optional()
        .describe(
          "TeamReach group ID or alias to book in. Defaults to TEAMREACH_BOOKING_GROUP env var."
        ),
    },
    async ({ monday_date, group_id }) => {
      const gid = getBookingGroup(group_id);
      const monday = getTargetMonday(monday_date);

      const wednesday = new Date(monday);
      wednesday.setDate(monday.getDate() + 2);

      const friday = new Date(monday);
      friday.setDate(monday.getDate() + 4);

      const days = [
        { title: "Monday", date: monday },
        { title: "Wednesday", date: wednesday },
        { title: "Friday", date: friday },
      ];

      const results: string[] = [];

      for (const { title, date } of days) {
        const dateStr = formatDate(date);
        const result = await createEvent({
          gid,
          title,
          startDatetime: `${dateStr} 06:00:00`,
          endDatetime: `${dateStr} 08:00:00`,
          maxParticipants: 12,
        });
        results.push(
          `Created "${title}" (eid: ${result.eventId}) — ${dateStr} 06:00-08:00`
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Booked events for week of ${formatDate(monday)} in group ${gid}:\n\n${results.join("\n")}`,
          },
        ],
      };
    }
  );
}
