declare module "@vercel/mcp-adapter" {
  import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

  interface Config {
    redisUrl?: string;
    basePath?: string;
    verboseLogs?: boolean;
  }

  interface ServerOptions {
    serverInfo?: {
      name: string;
      version: string;
    };
  }

  export function createMcpHandler(
    setup: (server: McpServer) => void | Promise<void>,
    serverOptions?: ServerOptions,
    config?: Config
  ): (req: Request) => Promise<Response>;
}
