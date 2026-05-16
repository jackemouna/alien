import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { resolveStateDir } from "../config/paths.js";
import { logWarn } from "../logger.js";
import { readCapabilityRequests } from "../projects/capability-requests-store.js";
import { listProjectIds, listTasks, loadProject, saveProject } from "../projects/store.js";
import type { Project } from "../projects/types.js";

/**
 * /mcp — Model Context Protocol server surface.
 *
 * Mounting Alien as an MCP server lets Claude Code (which IS billed against
 * the user's Pro/Max subscription) use Alien's projects, capability requests,
 * and activity tail as tools. The reasoning runs in Claude Code; the tool
 * calls hit this loopback endpoint and execute against Alien's stores
 * directly.
 *
 *   POST /mcp          — JSON-RPC over Streamable HTTP (stateless)
 *   GET  /mcp/info     — operator help page with the Claude Code config
 *
 * Stateless transport: each request gets a fresh McpServer + transport pair
 * so concurrent calls cannot share request-id state. Loopback-only, no auth
 * (Claude Code runs on the same machine as the gateway).
 */

const PATHS = new Set(["/mcp", "/mcp/info"]);

export function isMcpServerPath(pathname: string): boolean {
  return PATHS.has(pathname);
}

export async function handleMcpServerRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isMcpServerPath(pathname)) return false;
  if (!isLoopbackRequest(req)) {
    sendJsonResponse(res, 403, { error: { type: "forbidden", message: "Loopback-only" } });
    return true;
  }

  if (pathname === "/mcp/info") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(renderInfoHtml(req));
    return true;
  }

  // /mcp — Streamable HTTP transport. The MCP spec uses POST for client
  // → server JSON-RPC; GET is optional for a long-poll SSE channel. We
  // route both through handleRequest and let the transport decide.
  if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST, GET, DELETE");
    res.end();
    return true;
  }

  let parsedBody: unknown;
  if (req.method === "POST") {
    try {
      parsedBody = await readRequestJson(req);
    } catch (err) {
      sendJsonResponse(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: `Parse error: ${stringifyError(err)}` },
        id: null,
      });
      return true;
    }
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildMcpServer();
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    logWarn(`gateway.mcp.handle_failed: ${stringifyError(err)}`);
    if (!res.headersSent) {
      sendJsonResponse(res, 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: stringifyError(err) },
        id: null,
      });
    }
  } finally {
    // The transport cleans up its own connection once the response is sent.
    // Closing the server releases the McpServer's handler tables for GC.
    void server.close().catch(() => {});
  }
  return true;
}

// ---- tool registration ----

function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: "alien", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Alien is your AI workforce. Use these tools to list and create " +
        "Projects (each project carries a goal the autonomous workforce " +
        "works toward), review capability requests the planner has raised, " +
        "and tail the security audit log.",
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List Alien projects",
      description:
        "Returns every project Alien has on disk: id, name, goal, status, " +
        "channels, created timestamp. No arguments.",
    },
    async () => {
      const projectsDir = resolveProjectsDir();
      const ids = listProjectIds(projectsDir);
      const projects = ids
        .map((id) => loadProject(projectsDir, id))
        .filter((p): p is Project => Boolean(p));
      return {
        content: [{ type: "text", text: JSON.stringify({ projects }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_project",
    {
      title: "Get Alien project + tasks",
      description: "Returns the project metadata and all tasks for the given project id.",
      inputSchema: {
        id: z.string().min(1).describe("Project id, e.g. 'proj-1715-abcd12'"),
      },
    },
    async ({ id }) => {
      const projectsDir = resolveProjectsDir();
      const project = loadProject(projectsDir, id);
      if (!project) {
        return {
          isError: true,
          content: [{ type: "text", text: `project not found: ${id}` }],
        };
      }
      const tasks = listTasks(projectsDir, id);
      return {
        content: [{ type: "text", text: JSON.stringify({ project, tasks }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "create_project",
    {
      title: "Create Alien project",
      description:
        "Creates a new project with the given name and goal. The autonomous " +
        "workforce will pick tasks up once the planner emits a task DAG (use " +
        "Alien's UI or the projects HTTP API for plan + commit-plan).",
      inputSchema: {
        name: z.string().min(1).describe("Short human-readable project name"),
        goal: z
          .string()
          .optional()
          .describe("What the workforce should achieve. Defaults to `name` if omitted."),
        owner: z.string().optional().describe("Operator/handle. Defaults to 'operator'."),
      },
    },
    async ({ name, goal, owner }) => {
      const projectsDir = resolveProjectsDir();
      const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const project: Project = {
        id,
        name: name.trim(),
        goal: (goal ?? name).trim(),
        owner: (owner ?? "operator").trim(),
        createdAt: new Date().toISOString(),
        status: "active",
        channels: [],
      };
      saveProject(projectsDir, project);
      return {
        content: [{ type: "text", text: JSON.stringify({ project }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "list_capability_requests",
    {
      title: "List capability requests",
      description:
        "Returns every capability request the planner has raised — an " +
        "integration or tool Alien doesn't yet have. Status filter is optional.",
      inputSchema: {
        status: z
          .enum(["open", "in-progress", "fulfilled", "rejected"])
          .optional()
          .describe("Filter to a single status. Omit to return everything."),
      },
    },
    async ({ status }) => {
      const all = await readCapabilityRequests();
      const filtered = status ? all.filter((r) => r.status === status) : all;
      return {
        content: [{ type: "text", text: JSON.stringify({ requests: filtered }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "recent_activity",
    {
      title: "Recent Alien activity",
      description:
        "Tails the tamper-evident audit log under ~/.alien/audit.log. Returns " +
        "the last N entries (default 20, max 200).",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ limit }) => {
      const entries = await tailAuditLog(limit ?? 20);
      return {
        content: [{ type: "text", text: JSON.stringify({ entries }, null, 2) }],
      };
    },
  );

  return server;
}

// ---- helpers ----

function resolveProjectsDir(): string {
  return path.join(resolveStateDir(process.env), "projects");
}

function resolveAuditLogPath(): string {
  return path.join(resolveStateDir(process.env), "audit.log");
}

async function tailAuditLog(limit: number): Promise<unknown[]> {
  const { promises: fsp } = await import("node:fs");
  try {
    const raw = await fsp.readFile(resolveAuditLogPath(), "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    const tail = lines.slice(-limit);
    return tail.map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { malformed: true, raw: line };
      }
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.startsWith("::ffff:127.")
  );
}

async function readRequestJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  const max = 1024 * 1024; // 1 MiB cap — MCP JSON-RPC frames are tiny.
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > max) throw new Error("Payload too large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return undefined;
  return JSON.parse(text);
}

function sendJsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---- /mcp/info help page ----

function renderInfoHtml(req: IncomingMessage): string {
  const host = req.headers.host ?? "127.0.0.1:19001";
  const url = `http://${host}/mcp`;
  const snippet = JSON.stringify(
    {
      mcpServers: {
        alien: {
          type: "http",
          url,
        },
      },
    },
    null,
    2,
  );
  const cliCmd = `claude mcp add --transport http alien ${url}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>👾 Alien · MCP server</title>
<style>
  :root { color-scheme: dark; }
  body {
    font: 14px/1.55 -apple-system, "SF Pro Text", system-ui, sans-serif;
    background: #0b0a08; color: #f4ecd8; margin: 0;
    padding: 48px 32px; max-width: 760px;
  }
  h1 { font-weight: 600; letter-spacing: 0.01em; margin: 0 0 8px; font-size: 22px; }
  .sub { color: #b8a98a; margin-bottom: 32px; }
  h2 { font-weight: 600; font-size: 16px; margin: 28px 0 8px; color: #e6cf8a; }
  p { margin: 0 0 12px; }
  pre {
    background: #16140f; color: #e8d8a8; border: 1px solid #2a261d;
    padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 13px;
  }
  code { background: #16140f; padding: 1px 6px; border-radius: 4px; color: #e6cf8a; }
  ul { margin: 0 0 16px; padding-left: 18px; }
  li { margin: 4px 0; }
  a { color: #e6cf8a; }
</style>
</head>
<body>
<h1>👾 Alien · MCP server</h1>
<div class="sub">Use your Claude Pro/Max subscription to drive Alien.</div>

<p>
  This endpoint exposes Alien's projects, capability requests, and activity
  tail as Model Context Protocol tools. Wire it into Claude Code and the
  reasoning runs against your subscription while tool calls execute locally
  against Alien.
</p>

<h2>1. Add to Claude Code (one-liner)</h2>
<pre>${escapeHtml(cliCmd)}</pre>

<h2>2. Or paste into <code>~/.claude.json</code> manually</h2>
<pre>${escapeHtml(snippet)}</pre>

<h2>3. Verify</h2>
<ul>
  <li>Run <code>claude mcp list</code> — Alien should appear as connected.</li>
  <li>In a Claude Code session, ask "list my Alien projects" — it will call <code>alien:list_projects</code>.</li>
</ul>

<h2>Tools currently exposed</h2>
<ul>
  <li><code>list_projects</code> — every project on disk</li>
  <li><code>get_project</code> — project + tasks for an id</li>
  <li><code>create_project</code> — create a new project (name, goal, owner?)</li>
  <li><code>list_capability_requests</code> — planner-raised integration requests</li>
  <li><code>recent_activity</code> — tail of <code>~/.alien/audit.log</code></li>
</ul>

<p style="margin-top:32px; color:#7a6f57; font-size:12px;">
  Loopback-only · no bearer required · Alien runs on the same machine as Claude Code.
</p>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
