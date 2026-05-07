/**
 * Standalone MCP server for selected built-in Alien tools.
 *
 * Run via: node --import tsx src/mcp/alien-tools-serve.ts
 * Or: bun src/mcp/alien-tools-serve.ts
 */
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { createCronTool } from "../agents/tools/cron-tool.js";
import { formatErrorMessage } from "../infra/errors.js";
import { connectToolsMcpServerToStdio, createToolsMcpServer } from "./tools-stdio-server.js";

export function resolveAlienToolsForMcp(): AnyAgentTool[] {
  return [createCronTool()];
}

function createAlienToolsMcpServer(
  params: {
    tools?: AnyAgentTool[];
  } = {},
): Server {
  const tools = params.tools ?? resolveAlienToolsForMcp();
  return createToolsMcpServer({ name: "alien-tools", tools });
}

async function serveAlienToolsMcp(): Promise<void> {
  const server = createAlienToolsMcpServer();
  await connectToolsMcpServerToStdio(server);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  serveAlienToolsMcp().catch((err) => {
    process.stderr.write(`alien-tools-serve: ${formatErrorMessage(err)}\n`);
    process.exit(1);
  });
}
