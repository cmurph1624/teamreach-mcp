import { createMcpHandler } from "@vercel/mcp-adapter";
import { register as registerReadMessages } from "../src/tools/read-messages.js";
import { register as registerPostMessage } from "../src/tools/post-message.js";
import { register as registerCheckOpenings } from "../src/tools/check-openings.js";
import { register as registerCheckRsvps } from "../src/tools/check-rsvps.js";
import { register as registerNotifyDrop } from "../src/tools/notify-drop.js";
import { register as registerCreateEvent } from "../src/tools/create-event.js";
import { register as registerBookWeekly } from "../src/tools/book-weekly-events.js";
import { register as registerGetParticipation } from "../src/tools/get-participation.js";

function authenticate(req: Request): Response | null {
  const secret = process.env.MCP_SECRET;
  if (!secret) return new Response("Server misconfigured", { status: 500 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

const mcpHandler = createMcpHandler(
  (server) => {
    registerReadMessages(server);
    registerPostMessage(server);
    registerCheckOpenings(server);
    registerCheckRsvps(server);
    registerNotifyDrop(server);
    registerCreateEvent(server);
    registerBookWeekly(server);
    registerGetParticipation(server);
  },
  {},
  {
    basePath: "/api",
    verboseLogs: true,
  }
);

async function handler(req: Request): Promise<Response> {
  const authResponse = authenticate(req);
  if (authResponse) return authResponse;
  return mcpHandler(req);
}

export { handler as GET, handler as POST, handler as DELETE };
