import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertGroupAllowed, fetchMessages, resolveGroupId } from "../lib/teamreach-api.js";

export function register(server: McpServer) {
  server.tool(
    "teamreach_read_messages",
    "Read recent group chat messages from a TeamReach group",
    {
      group_id: z.string().describe("TeamReach group ID, or an alias from TEAMREACH_GROUP_ALIASES"),
      num_records: z
        .number()
        .optional()
        .default(20)
        .describe("Number of messages to fetch (default: 20)"),
      since_date: z
        .string()
        .optional()
        .describe(
          'Only fetch messages since this datetime (ISO format, e.g. "2026-05-01 08:00:00")'
        ),
    },
    async ({ group_id: raw_group_id, num_records, since_date }) => {
      const group_id = resolveGroupId(raw_group_id);
      assertGroupAllowed(group_id);
      const messages = await fetchMessages(group_id, num_records, since_date);

      if (messages.length === 0) {
        return {
          content: [
            { type: "text", text: `No messages found in group ${group_id}.` },
          ],
        };
      }

      const formatted = messages.map((msg) => {
        const author = `${msg.FirstName} ${msg.LastName}`;
        const text = (msg.Message || "").trim();
        const comments = msg.grpmsgcomments || [];
        let line = `[${msg.CreatedOn}] ${author}\n  ${text.replace(/\n/g, "\n  ")}`;
        if (comments.length > 0) {
          line += `\n  -- ${comments.length} comment(s) --`;
          for (const c of comments) {
            line += `\n    [${c.DisplayCreatedOn || c.CreatedOn || ""}] ${c.FirstName} ${c.LastName}: ${c.Comment}`;
          }
        }
        return line;
      });

      return {
        content: [
          {
            type: "text",
            text: `${messages.length} message(s) from group ${group_id}:\n\n${formatted.join("\n\n")}`,
          },
        ],
      };
    }
  );
}
