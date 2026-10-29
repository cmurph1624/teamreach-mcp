import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertGroupAllowed, postMessage } from "../lib/teamreach-api.js";
import {
  loadPendingDrop,
  claimPendingDrop,
  releasePendingDrop,
} from "../lib/supabase.js";
import { evaluateNotifyDrop } from "../lib/rsvp-logic.js";

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export function register(server: McpServer) {
  server.tool(
    "teamreach_notify_drop",
    "Post a single, pre-validated RSVP-drop announcement to its TeamReach group. " +
      "Accepts only references to a drop that teamreach_check_rsvps already detected " +
      "(event_id + dropped_user_id). The message text is rendered server-side from the " +
      "detected data and cannot be supplied by the caller, so it can never post a player " +
      "or event the detector did not actually find.",
    {
      event_id: z
        .string()
        .describe("EventId from a change returned by teamreach_check_rsvps"),
      dropped_user_id: z
        .string()
        .describe("droppedUser.userId from that same change"),
    },
    async ({ event_id, dropped_user_id }) => {
      // 1. PROVENANCE — the drop must exist in the code-written ledger. A fabricated
      //    (event_id, user_id) has no row, so there is nothing to post.
      const drop = await loadPendingDrop(event_id, dropped_user_id);
      if (!drop) {
        return text(
          `No pending drop for event ${event_id} / user ${dropped_user_id}. ` +
            `Only drops detected by teamreach_check_rsvps can be posted.`
        );
      }

      // 2. ALLOWLIST — defense in depth; never post to a group outside the allowlist.
      try {
        assertGroupAllowed(drop.group_id);
      } catch (err) {
        return text(err instanceof Error ? err.message : String(err));
      }

      // 3. POLICY — recompute the time window from ground truth and render the text.
      const decision = evaluateNotifyDrop(drop, Date.now());
      if (!decision.shouldPost || !decision.text) {
        return text(`Not posting: ${decision.reason}`);
      }

      // 4. IDEMPOTENCY — atomically claim before posting so retries / overlapping
      //    runs cannot double-post the same drop.
      const claimed = await claimPendingDrop(event_id, dropped_user_id);
      if (!claimed) {
        return text(
          `Drop ${event_id}/${dropped_user_id} was already claimed or posted; skipping.`
        );
      }

      // 5. EFFECT — on failure, release the claim so a transient error does not
      //    strand the drop as permanently posted.
      try {
        await postMessage(drop.group_id, decision.text);
      } catch (err) {
        await releasePendingDrop(event_id, dropped_user_id);
        return text(
          `Post to group ${drop.group_id} failed (claim released): ` +
            (err instanceof Error ? err.message : String(err))
        );
      }

      return text(`Posted to group ${drop.group_id}: ${decision.text}`);
    }
  );
}
