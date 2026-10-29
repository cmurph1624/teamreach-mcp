import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  assertGroupAllowed,
  createEvent,
  fetchEvents,
  resolveGroupId,
} from "../lib/teamreach-api.js";

export function register(server: McpServer) {
  server.tool(
    "teamreach_create_event",
    "Create a new event in a TeamReach group. Only use when explicitly instructed.",
    {
      group_id: z.string().describe("TeamReach group ID, or an alias from TEAMREACH_GROUP_ALIASES"),
      title: z.string().describe("Event title"),
      start_datetime: z
        .string()
        .describe('Start time in "YYYY-MM-DD HH:MM:SS" format (local timezone)'),
      end_datetime: z
        .string()
        .describe('End time in "YYYY-MM-DD HH:MM:SS" format (local timezone)'),
      max_participants: z
        .number()
        .optional()
        .default(12)
        .describe("Maximum participants (default: 12, 0 = unlimited)"),
    },
    async ({ group_id: raw_group_id, title, start_datetime, end_datetime, max_participants }) => {
      const group_id = resolveGroupId(raw_group_id);
      assertGroupAllowed(group_id);
      const result = await createEvent({
        gid: group_id,
        title,
        startDatetime: start_datetime,
        endDatetime: end_datetime,
        maxParticipants: max_participants,
      });
      return {
        content: [
          {
            type: "text",
            text: `Created event "${title}" (eid: ${result.eventId}) in group ${group_id}\n  Start: ${start_datetime}\n  End: ${end_datetime}\n  Max participants: ${max_participants}`,
          },
        ],
      };
    }
  );

  server.tool(
    "teamreach_copy_event",
    "Copy an existing event to a new date/time, preserving all settings. Only use when explicitly instructed.",
    {
      group_id: z.string().describe("TeamReach group ID, or an alias from TEAMREACH_GROUP_ALIASES"),
      event_id: z.string().describe("Source event ID to copy"),
      new_start_datetime: z
        .string()
        .describe('New start time in "YYYY-MM-DD HH:MM:SS" format'),
      new_end_datetime: z
        .string()
        .describe('New end time in "YYYY-MM-DD HH:MM:SS" format'),
    },
    async ({ group_id: raw_group_id, event_id, new_start_datetime, new_end_datetime }) => {
      const group_id = resolveGroupId(raw_group_id);
      assertGroupAllowed(group_id);

      const events = await fetchEvents(group_id);
      const source = events.find(
        (e) => String(e.EventId || e.eventId) === String(event_id)
      );
      if (!source) {
        throw new Error(`Event ${event_id} not found in group ${group_id}`);
      }

      const title = String(source.Title || source.title || "");
      const maxParticipants =
        parseInt(source.MaximumParticipants || "0", 10) || 12;
      const location = String(source.Location || source.location || "");
      const details = String(source.EventDetails || source.eventDetails || "");

      const result = await createEvent({
        gid: group_id,
        title,
        startDatetime: new_start_datetime,
        endDatetime: new_end_datetime,
        maxParticipants,
        location,
        details,
      });

      return {
        content: [
          {
            type: "text",
            text: `Copied event "${title}" (source eid: ${event_id}) -> new eid: ${result.eventId} in group ${group_id}\n  New start: ${new_start_datetime}\n  New end: ${new_end_datetime}`,
          },
        ],
      };
    }
  );
}
