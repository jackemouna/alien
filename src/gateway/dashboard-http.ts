import { promises as fsp } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { readCapabilityRequests } from "../projects/capability-requests-store.js";
import { listProjectIds, loadProject, saveProject } from "../projects/store.js";
import type { Project } from "../projects/types.js";
import {
  isClaudeCodeSessionExpiringSoon,
  readClaudeCodeSession,
} from "../security/claude-code-session.js";
import { sendJson } from "./http-common.js";

/**
 * /dashboard — the premium home for Alien.
 *
 * Brings every operator surface (projects, channels, activity, capabilities,
 * soul, integrations) into one gold/ivory/black landing page and exposes a
 * single "Start a new mission" prompt that creates a project from one
 * sentence. Loopback-only.
 *
 *   GET  /dashboard               — HTML
 *   GET  /v1/dashboard/state      — projects + channels + activity + caps
 *   POST /v1/dashboard/mission    — { prompt, name?, owner? } → project
 */

const PATHS = new Set(["/dashboard", "/v1/dashboard/state", "/v1/dashboard/mission"]);

export function isDashboardPath(pathname: string): boolean {
  return PATHS.has(pathname);
}

export async function handleDashboardRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isDashboardPath(pathname)) return false;
  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { error: { type: "forbidden", message: "Loopback-only" } });
    return true;
  }

  if (pathname === "/dashboard") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(renderDashboardHtml());
    return true;
  }

  if (pathname === "/v1/dashboard/state") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    sendJson(res, 200, await readDashboardState());
    return true;
  }

  if (pathname === "/v1/dashboard/mission") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end();
      return true;
    }
    try {
      const body = await readJson(req);
      const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) {
        sendJson(res, 400, { error: { type: "invalid_request", message: "prompt is required" } });
        return true;
      }
      const name =
        typeof body?.name === "string" && body.name.trim().length > 0
          ? body.name.trim()
          : deriveName(prompt);
      const owner =
        typeof body?.owner === "string" && body.owner.trim().length > 0
          ? body.owner.trim()
          : "operator";
      const project = createMissionProject({ name, goal: prompt, owner });
      sendJson(res, 201, { project });
    } catch (err) {
      sendJson(res, 500, {
        error: { type: "internal", message: err instanceof Error ? err.message : String(err) },
      });
    }
    return true;
  }

  return false;
}

// ---- state ----

type ChannelStatus = "enabled" | "disabled";
type IntegrationStatus = "claude-code-session" | "wizard-oauth" | "api-key" | "not-connected";

type DashboardState = {
  readonly projects: readonly DashboardProject[];
  readonly channels: readonly { id: string; status: ChannelStatus }[];
  readonly capabilities: { openCount: number; totalCount: number };
  readonly activity: readonly DashboardAuditEntry[];
  readonly soul: { name: string; role: string; purpose: string; configured: boolean };
  readonly integrations: {
    anthropic: { status: IntegrationStatus; hint?: string };
    openai: { status: IntegrationStatus };
  };
  readonly stats: { projectCount: number; activeMissionCount: number };
};

type DashboardProject = {
  readonly id: string;
  readonly name: string;
  readonly goal: string;
  readonly status: string;
  readonly createdAt: string;
  readonly channels: readonly string[];
};

type DashboardAuditEntry = {
  readonly ts: string;
  readonly kind: string;
  readonly summary: string;
};

async function readDashboardState(): Promise<DashboardState> {
  const [projects, channels, capabilities, activity, soul, integrations] = await Promise.all([
    readProjectsState(),
    readChannelsState(),
    readCapabilitiesState(),
    readActivityState(),
    readSoulState(),
    readIntegrationsState(),
  ]);
  const activeMissionCount = projects.filter((p) => p.status === "active").length;
  return {
    projects,
    channels,
    capabilities,
    activity,
    soul,
    integrations,
    stats: { projectCount: projects.length, activeMissionCount },
  };
}

async function readProjectsState(): Promise<DashboardProject[]> {
  const dir = resolveProjectsDir();
  const ids = listProjectIds(dir);
  const out: DashboardProject[] = [];
  for (const id of ids) {
    const p = loadProject(dir, id);
    if (!p) continue;
    out.push({
      id: p.id,
      name: p.name,
      goal: p.goal,
      status: p.status,
      createdAt: p.createdAt,
      channels: p.channels.map((c) => c.channel),
    });
  }
  // newest first
  return out.toSorted((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
}

async function readChannelsState(): Promise<{ id: string; status: ChannelStatus }[]> {
  const stateDir = resolveStateDir(process.env);
  try {
    const raw = await fsp.readFile(path.join(stateDir, "channels.json"), "utf8");
    const parsed = JSON.parse(raw) as { enabled?: Record<string, boolean> };
    const enabled = parsed.enabled ?? {};
    return Object.entries(enabled).map(([id, on]) => ({
      id,
      status: on ? "enabled" : "disabled",
    }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

async function readCapabilitiesState(): Promise<{ openCount: number; totalCount: number }> {
  try {
    const all = await readCapabilityRequests();
    return {
      openCount: all.filter((r) => r.status === "open").length,
      totalCount: all.length,
    };
  } catch {
    return { openCount: 0, totalCount: 0 };
  }
}

async function readActivityState(): Promise<DashboardAuditEntry[]> {
  const stateDir = resolveStateDir(process.env);
  try {
    const raw = await fsp.readFile(path.join(stateDir, "audit.log"), "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    const tail = lines.slice(-8).reverse();
    return tail
      .map((line) => {
        try {
          const e = JSON.parse(line) as {
            ts: string;
            kind: string;
            payload?: Record<string, unknown>;
          };
          return { ts: e.ts, kind: e.kind, summary: summarizePayload(e.payload) };
        } catch {
          return null;
        }
      })
      .filter((e): e is DashboardAuditEntry => e !== null);
  } catch {
    return [];
  }
}

function summarizePayload(payload: Record<string, unknown> | undefined): string {
  if (!payload) return "";
  const interesting = ["projectId", "taskId", "name", "kind", "channel", "tool", "path"];
  const parts: string[] = [];
  for (const key of interesting) {
    const v = payload[key];
    if (typeof v === "string" || typeof v === "number") {
      parts.push(`${key}=${v}`);
      if (parts.length === 2) break;
    }
  }
  return parts.join(" · ");
}

async function readSoulState(): Promise<{
  name: string;
  role: string;
  purpose: string;
  configured: boolean;
}> {
  const workspace = await resolveWorkspaceDir();
  if (!workspace) {
    return { name: "Alien", role: "your AI workforce", purpose: "", configured: false };
  }
  try {
    const soulMd = await fsp.readFile(path.join(workspace, "SOUL.md"), "utf8");
    const name = extractField(soulMd, "Name") || "Alien";
    const role = extractField(soulMd, "Role") || "your AI workforce";
    const purpose = extractField(soulMd, "Purpose") || "";
    return { name, role, purpose, configured: true };
  } catch {
    return { name: "Alien", role: "your AI workforce", purpose: "", configured: false };
  }
}

function extractField(md: string, field: string): string {
  const pattern = new RegExp(`^##\\s+${field}\\s*$([\\s\\S]*?)^(?:##\\s|$)`, "m");
  const m = md.match(pattern);
  if (!m || !m[1]) return "";
  return m[1].trim().split("\n")[0]?.trim() ?? "";
}

async function readIntegrationsState(): Promise<DashboardState["integrations"]> {
  let anthropicStatus: IntegrationStatus = "not-connected";
  let anthropicHint: string | undefined;
  const claudeCodeSession = readClaudeCodeSession();
  if (claudeCodeSession) {
    anthropicStatus = "claude-code-session";
    anthropicHint = isClaudeCodeSessionExpiringSoon(claudeCodeSession)
      ? "expiring soon — re-login to Claude Code"
      : "billing against your Pro/Max plan";
  } else {
    // Wizard/OAuth/API key inspection would duplicate integrations-http;
    // for the dashboard's purposes a coarse "is anything wired" is enough.
    const stateDir = resolveStateDir(process.env);
    try {
      await fsp.access(path.join(stateDir, "anthropic-oauth.json"));
      anthropicStatus = "wizard-oauth";
    } catch {
      // leave as not-connected
    }
  }

  let openaiStatus: IntegrationStatus = "not-connected";
  const stateDir = resolveStateDir(process.env);
  try {
    await fsp.access(path.join(stateDir, "openai-oauth.json"));
    openaiStatus = "wizard-oauth";
  } catch {
    // leave as not-connected
  }

  return {
    anthropic: anthropicHint
      ? { status: anthropicStatus, hint: anthropicHint }
      : { status: anthropicStatus },
    openai: { status: openaiStatus },
  };
}

async function resolveWorkspaceDir(): Promise<string | undefined> {
  const stateDir = resolveStateDir(process.env);
  try {
    const raw = await fsp.readFile(path.join(stateDir, "alien.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      agents?: { defaults?: { workspace?: string } };
    };
    return parsed.agents?.defaults?.workspace;
  } catch {
    return undefined;
  }
}

// ---- mission creation ----

function createMissionProject(input: { name: string; goal: string; owner: string }): Project {
  const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const project: Project = {
    id,
    name: input.name,
    goal: input.goal,
    owner: input.owner,
    createdAt: new Date().toISOString(),
    status: "active",
    channels: [],
  };
  saveProject(resolveProjectsDir(), project);
  return project;
}

function deriveName(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 60) return oneLine;
  return `${oneLine.slice(0, 57)}…`;
}

// ---- helpers ----

function resolveProjectsDir(): string {
  return path.join(resolveStateDir(process.env), "projects");
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

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  const max = 256 * 1024;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > max) throw new Error("Payload too large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return undefined;
  const parsed = JSON.parse(text) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return undefined;
}

// ---- HTML ----

function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>👾 Alien · Dashboard</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0a08;
    --bg-elev: #14120e;
    --bg-card: #16140f;
    --line: #2a261d;
    --line-strong: #3a3325;
    --text: #f4ecd8;
    --text-dim: #b8a98a;
    --text-mute: #7a6f57;
    --gold: #e6cf8a;
    --gold-strong: #f3dc99;
    --ok: #9bd29b;
    --warn: #e8b96a;
    --bad: #d98a8a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.55 -apple-system, "SF Pro Text", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .shell {
    max-width: 1080px;
    padding: 48px 32px 80px;
    margin: 0 auto;
  }
  header.hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 32px;
  }
  .brand {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: 0.01em;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand .glyph { font-size: 36px; }
  .greeting {
    color: var(--text-dim);
    margin-top: 6px;
    font-size: 14px;
  }
  .greeting strong { color: var(--gold); font-weight: 500; }

  .mission-card {
    background: linear-gradient(180deg, #1a1611 0%, #14110d 100%);
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    padding: 28px;
    margin-bottom: 40px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.02) inset, 0 24px 80px -32px rgba(230,207,138,0.08);
  }
  .mission-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--gold);
    margin-bottom: 12px;
  }
  .mission-prompt {
    width: 100%;
    background: transparent;
    border: none;
    color: var(--text);
    font: 18px/1.4 -apple-system, "SF Pro Text", system-ui, sans-serif;
    resize: vertical;
    min-height: 72px;
    padding: 0;
    outline: none;
  }
  .mission-prompt::placeholder { color: var(--text-mute); }
  .mission-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
    gap: 16px;
  }
  .mission-hint { color: var(--text-mute); font-size: 12px; }
  .launch {
    background: var(--gold);
    color: #1a1409;
    border: none;
    padding: 10px 22px;
    border-radius: 8px;
    font: 600 14px -apple-system, system-ui, sans-serif;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.05s ease;
  }
  .launch:hover { background: var(--gold-strong); }
  .launch:active { transform: translateY(1px); }
  .launch:disabled { opacity: 0.5; cursor: not-allowed; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
    margin-bottom: 32px;
  }
  .stat {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 18px 20px;
  }
  .stat .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-mute);
    margin-bottom: 8px;
  }
  .stat .value {
    font-size: 24px;
    font-weight: 600;
    color: var(--text);
    line-height: 1.2;
  }
  .stat .value small {
    font-size: 13px;
    font-weight: 400;
    color: var(--text-dim);
    margin-left: 6px;
  }
  .stat .sub {
    color: var(--text-dim);
    font-size: 12px;
    margin-top: 6px;
  }

  section.panel {
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: 12px;
    margin-bottom: 20px;
    overflow: hidden;
  }
  section.panel > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 22px;
    border-bottom: 1px solid var(--line);
  }
  section.panel > header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  section.panel > header a {
    color: var(--text-dim);
    text-decoration: none;
    font-size: 13px;
  }
  section.panel > header a:hover { color: var(--gold); }
  .panel-body { padding: 18px 22px; }
  .empty { color: var(--text-mute); font-style: italic; }

  .project {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px 16px;
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }
  .project:last-child { border-bottom: none; }
  .project .name { font-weight: 500; color: var(--text); font-size: 15px; }
  .project .goal { color: var(--text-dim); font-size: 13px; grid-column: 1 / -1; }
  .project .meta { color: var(--text-mute); font-size: 12px; text-align: right; white-space: nowrap; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    background: #1f1c14;
    color: var(--text-dim);
    border: 1px solid var(--line);
  }
  .badge.active { color: var(--ok); border-color: rgba(155,210,155,0.25); }
  .badge.archived { color: var(--text-mute); }
  .badge.paused { color: var(--warn); border-color: rgba(232,185,106,0.3); }
  .badge.achieved { color: var(--gold); border-color: rgba(230,207,138,0.4); }
  .badge.needs-input { color: var(--bad); border-color: rgba(217,138,138,0.35); }

  .row {
    display: flex; gap: 8px; align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }
  .row:last-child { border-bottom: none; }
  .row .ts { color: var(--text-mute); font-variant-numeric: tabular-nums; font-size: 12px; min-width: 64px; }
  .row .kind { color: var(--gold); font-family: ui-monospace, "SF Mono", monospace; font-size: 12px; }
  .row .summary { color: var(--text-dim); font-family: ui-monospace, "SF Mono", monospace; font-size: 12px; }

  .chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: #1c1812; padding: 6px 12px; border-radius: 999px;
    border: 1px solid var(--line); color: var(--text-dim); font-size: 13px;
  }
  .chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-mute); }
  .chip.on .dot { background: var(--ok); }
  .chip.off .dot { background: var(--bad); }

  nav.quick {
    display: flex; flex-wrap: wrap; gap: 8px;
    margin-bottom: 32px;
  }
  nav.quick a {
    text-decoration: none;
    color: var(--text-dim);
    background: var(--bg-card);
    border: 1px solid var(--line);
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 13px;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  nav.quick a:hover { color: var(--gold); border-color: var(--line-strong); }

  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--bg-card);
    border: 1px solid var(--gold);
    color: var(--text);
    padding: 12px 20px;
    border-radius: 10px;
    box-shadow: 0 20px 60px -20px rgba(0,0,0,0.6);
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.2s, transform 0.2s;
    pointer-events: none;
  }
  .toast.show { opacity: 1; transform: translateY(0); }

  footer.foot {
    margin-top: 48px;
    color: var(--text-mute);
    font-size: 12px;
    text-align: center;
  }
</style>
</head>
<body>
<div class="shell">
  <header class="hero">
    <div>
      <div class="brand"><span class="glyph">👾</span> Alien</div>
      <div class="greeting" id="greeting">Loading your AI workforce…</div>
    </div>
    <nav class="quick">
      <a href="/soul">Soul</a>
      <a href="/integrations">Integrations</a>
      <a href="/capabilities">Capabilities</a>
      <a href="/activity">Activity</a>
      <a href="/mcp/info">MCP</a>
    </nav>
  </header>

  <div class="mission-card">
    <div class="mission-label">Start a new mission</div>
    <textarea
      id="mission"
      class="mission-prompt"
      placeholder="Describe what should be achieved. One sentence is enough — Alien runs the rest."
    ></textarea>
    <div class="mission-actions">
      <div class="mission-hint">⌘ + Return to launch · Becomes a project goal the workforce picks up.</div>
      <button id="launch" class="launch">Launch mission</button>
    </div>
  </div>

  <div class="grid" id="stats">
    <div class="stat"><div class="label">Active missions</div><div class="value" id="stat-active">…</div></div>
    <div class="stat"><div class="label">All projects</div><div class="value" id="stat-projects">…</div></div>
    <div class="stat"><div class="label">Capability requests</div><div class="value" id="stat-caps">…</div><div class="sub" id="stat-caps-sub"></div></div>
    <div class="stat"><div class="label">Channels enabled</div><div class="value" id="stat-channels">…</div></div>
  </div>

  <section class="panel">
    <header><h2>Missions</h2><a href="/v1/dashboard/state">JSON state →</a></header>
    <div class="panel-body" id="projects"><div class="empty">Loading…</div></div>
  </section>

  <section class="panel">
    <header><h2>Recent activity</h2><a href="/activity">Live feed →</a></header>
    <div class="panel-body" id="activity"><div class="empty">Loading…</div></div>
  </section>

  <section class="panel">
    <header><h2>Channels</h2><a href="/setup">Wire one up →</a></header>
    <div class="panel-body" id="channels"><div class="empty">Loading…</div></div>
  </section>

  <section class="panel">
    <header><h2>Integrations</h2><a href="/integrations">Manage →</a></header>
    <div class="panel-body" id="integrations"><div class="empty">Loading…</div></div>
  </section>

  <footer class="foot">Loopback-only · 👾 Alien gateway · <span id="gateway-host"></span></footer>
</div>

<div id="toast" class="toast">Mission launched</div>

<script>
${dashboardScript()}
</script>
</body>
</html>`;
}

function dashboardScript(): string {
  return `
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

async function loadState() {
  try {
    const r = await fetch("/v1/dashboard/state", { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("state " + r.status);
    const s = await r.json();
    render(s);
  } catch (err) {
    $("greeting").textContent = "Could not load dashboard state — is the gateway running?";
  }
}

function render(s) {
  const soulName = (s.soul && s.soul.name) || "Alien";
  const soulRole = (s.soul && s.soul.role) || "your AI workforce";
  $("greeting").innerHTML = "Hello — this is <strong>" + escapeHtml(soulName) + "</strong>, " + escapeHtml(soulRole) + ".";
  $("gateway-host").textContent = location.host;

  $("stat-active").innerHTML = s.stats.activeMissionCount + " <small>running</small>";
  $("stat-projects").innerHTML = s.stats.projectCount + " <small>on disk</small>";
  $("stat-caps").innerHTML = (s.capabilities.openCount || 0) + " <small>open</small>";
  $("stat-caps-sub").textContent = s.capabilities.totalCount + " total requests raised";
  const channelsOn = (s.channels || []).filter((c) => c.status === "enabled").length;
  $("stat-channels").innerHTML = channelsOn + " <small>of " + (s.channels || []).length + "</small>";

  // Projects
  const projects = s.projects || [];
  $("projects").innerHTML = projects.length === 0
    ? '<div class="empty">No missions yet. Launch one above and the workforce picks it up.</div>'
    : projects.slice(0, 6).map((p) => {
        const badge = '<span class="badge ' + escapeHtml(p.status) + '">' + escapeHtml(p.status) + '</span>';
        const created = new Date(p.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        return '<div class="project">' +
          '<div class="name">' + escapeHtml(p.name) + '</div>' +
          '<div class="meta">' + badge + ' · ' + created + '</div>' +
          '<div class="goal">' + escapeHtml(p.goal) + '</div>' +
          '</div>';
      }).join("");

  // Activity
  const activity = s.activity || [];
  $("activity").innerHTML = activity.length === 0
    ? '<div class="empty">No activity yet.</div>'
    : activity.map((e) => {
        const t = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        return '<div class="row">' +
          '<div class="ts">' + escapeHtml(t) + '</div>' +
          '<div class="kind">' + escapeHtml(e.kind) + '</div>' +
          '<div class="summary">' + escapeHtml(e.summary) + '</div>' +
          '</div>';
      }).join("");

  // Channels
  const channels = s.channels || [];
  $("channels").innerHTML = channels.length === 0
    ? '<div class="empty">No channels wired. <a href="/setup" style="color: var(--gold);">Open the setup wizard</a> to add one.</div>'
    : '<div class="chip-row">' + channels.map((c) => {
        const cls = c.status === "enabled" ? "on" : "off";
        return '<div class="chip ' + cls + '"><span class="dot"></span>' + escapeHtml(c.id) + '</div>';
      }).join("") + '</div>';

  // Integrations
  const integrations = s.integrations || {};
  const integrationLine = (id, info) => {
    const labels = {
      "claude-code-session": "Claude Code session (subscription-billed)",
      "wizard-oauth": "OAuth (wizard)",
      "api-key": "API key",
      "not-connected": "not connected",
    };
    const onClass = info.status === "not-connected" ? "off" : "on";
    const hint = info.hint ? ' · ' + escapeHtml(info.hint) : '';
    return '<div class="chip ' + onClass + '"><span class="dot"></span>' +
      '<strong style="color: var(--text); margin-right: 4px;">' + escapeHtml(id) + '</strong>' +
      escapeHtml(labels[info.status] || info.status) + hint + '</div>';
  };
  $("integrations").innerHTML =
    '<div class="chip-row">' +
    integrationLine("Anthropic", integrations.anthropic || { status: "not-connected" }) +
    integrationLine("OpenAI", integrations.openai || { status: "not-connected" }) +
    '</div>';
}

async function launchMission() {
  const ta = $("mission");
  const prompt = (ta.value || "").trim();
  if (!prompt) {
    ta.focus();
    return;
  }
  const btn = $("launch");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Launching…";
  try {
    const r = await fetch("/v1/dashboard/mission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!r.ok) throw new Error("mission " + r.status);
    const out = await r.json();
    ta.value = "";
    showToast("Mission launched · " + (out.project && out.project.name ? out.project.name : "queued"));
    await loadState();
  } catch (err) {
    showToast("Could not launch: " + (err && err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function showToast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    launchMission();
  }
});
$("launch").addEventListener("click", launchMission);
loadState();
setInterval(loadState, 15000);
`;
}
