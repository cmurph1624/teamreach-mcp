#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(repoRoot, ".env.local") });

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = await import(
  "@modelcontextprotocol/sdk/server/stdio.js"
);

const { register: registerReadMessages } = await import(
  "../dist/src/tools/read-messages.js"
);
const { register: registerPostMessage } = await import(
  "../dist/src/tools/post-message.js"
);
const { register: registerCheckOpenings } = await import(
  "../dist/src/tools/check-openings.js"
);
const { register: registerCheckRsvps } = await import(
  "../dist/src/tools/check-rsvps.js"
);
const { register: registerNotifyDrop } = await import(
  "../dist/src/tools/notify-drop.js"
);
const { register: registerCreateEvent } = await import(
  "../dist/src/tools/create-event.js"
);
const { register: registerBookWeekly } = await import(
  "../dist/src/tools/book-weekly-events.js"
);
const { register: registerGetParticipation } = await import(
  "../dist/src/tools/get-participation.js"
);

const server = new McpServer({ name: "teamreach", version: "1.0.0" });
registerReadMessages(server);
registerPostMessage(server);
registerCheckOpenings(server);
registerCheckRsvps(server);
registerNotifyDrop(server);
registerCreateEvent(server);
registerBookWeekly(server);
registerGetParticipation(server);

await server.connect(new StdioServerTransport());
