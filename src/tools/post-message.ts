import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertGroupAllowed, postMessage, resolveGroupId } from "../lib/teamreach-api.js";

export function register(server: McpServer) {
  server.tool(
    "teamreach_post_message",
    "Post a message to a TeamReach group as Stig Claw. Only use when explicitly instructed.",
    {
      group_id: z.string().describe("TeamReach group ID, or an alias from TEAMREACH_GROUP_ALIASES"),
      message: z.string().describe("The message text to post"),
    },
    async ({ group_id: raw_group_id, message }) => {
      const group_id = resolveGroupId(raw_group_id);
      assertGroupAllowed(group_id);
      const result = await postMessage(group_id, message);
      return {
        content: [
          {
            type: "text",
            text: `Posted successfully to group ${group_id} (message ID: ${result.messageId})`,
          },
        ],
      };
    }
  );
}
