import { promises as fsp } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { BUNDLED_EXPERTS } from "../experts/builtin/index.js";
import { readCapabilityRequests } from "../projects/capability-requests-store.js";
import { listProjectIds, loadProject, saveProject } from "../projects/store.js";
import type { Project } from "../projects/types.js";
import {
  isClaudeCodeSessionExpiringSoon,
  readClaudeCodeSession,
} from "../security/claude-code-session.js";
import { readSecretFromEnvOrKeychain } from "../security/secret-source.js";
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
    gemini: { status: IntegrationStatus };
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
  readonly expertCount: number;
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
      expertCount: p.assignedExperts?.length ?? BUNDLED_EXPERTS.length,
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

  // Gemini: API-key only — no OAuth flow yet. Check env + keychain.
  let geminiStatus: IntegrationStatus = "not-connected";
  const geminiKey =
    readSecretFromEnvOrKeychain({
      envVarName: "GEMINI_API_KEY",
      keychain: { service: "alien.ai", account: "gemini-api-key" },
      keychainGate: "always",
    }) ??
    readSecretFromEnvOrKeychain({
      envVarName: "GOOGLE_API_KEY",
      keychain: { service: "alien.ai", account: "gemini-api-key" },
      keychainGate: "always",
    });
  if (geminiKey) geminiStatus = "api-key";

  return {
    anthropic: anthropicHint
      ? { status: anthropicStatus, hint: anthropicHint }
      : { status: anthropicStatus },
    openai: { status: openaiStatus },
    gemini: { status: geminiStatus },
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
    // Phase 1: every new mission starts with the full bundled roster.
    // The planner (Phase 2) will route each Task to the best-fit expert.
    assignedExperts: BUNDLED_EXPERTS.map((e) => e.id),
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
<title>👾 Alien</title>
<style>
  /* Apple-inspired design tokens. One accent. Generous space. */
  :root {
    color-scheme: light;
    --bg: #fafaf7;
    --surface: #ffffff;
    --line: #eceae3;
    --line-strong: #d9d6cb;
    --ink: #1a1814;
    --ink-soft: #4a4640;
    --ink-mute: #8a8378;
    --accent: #b89028;
    --accent-soft: #d9a936;
    --ok: #2b8a3e;
    --warn: #b06a16;
    --bad: #b8423a;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 20px -8px rgba(0,0,0,0.10);
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 15px/1.55 -apple-system, "SF Pro Text", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
  button { font-family: inherit; }

  /* Page shell — single column, max-width content */
  .shell {
    max-width: 720px;
    margin: 0 auto;
    padding: 56px 24px 80px;
  }

  /* Top bar — brand on the left, single quiet gear on the right */
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 56px;
  }
  .brand {
    display: flex; align-items: center; gap: 10px;
    font-size: 17px; font-weight: 600; letter-spacing: -0.01em;
  }
  .brand .glyph { font-size: 22px; }
  .gear {
    width: 36px; height: 36px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 50%;
    color: var(--ink-mute);
    transition: background 0.15s, color 0.15s;
  }
  .gear:hover { background: var(--surface); color: var(--ink); }
  .gear svg { width: 18px; height: 18px; }

  /* Hero — the one thing on this page */
  .hero { margin-bottom: 40px; }
  .hello {
    font-size: 32px; font-weight: 600; letter-spacing: -0.02em;
    color: var(--ink); margin: 0 0 8px;
  }
  .hello-sub {
    color: var(--ink-mute); font-size: 16px; line-height: 1.5; margin: 0;
  }

  /* The primary input — one big text field, one button */
  .composer {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: 24px 24px 18px;
    box-shadow: var(--shadow-sm);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .composer:focus-within {
    border-color: var(--line-strong);
    box-shadow: var(--shadow-md);
  }
  .composer-label {
    font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.14em;
    color: var(--ink-mute); margin: 0 0 12px;
  }
  .composer textarea {
    width: 100%;
    background: transparent; border: none; outline: none;
    color: var(--ink);
    font: 17px/1.5 inherit; resize: none;
    min-height: 56px; padding: 0;
  }
  .composer textarea::placeholder { color: var(--ink-mute); }
  .composer-row {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 16px; gap: 16px;
  }
  .composer-help {
    color: var(--ink-mute); font-size: 12px;
  }
  .btn-primary {
    background: var(--ink); color: #fff; border: none;
    padding: 10px 20px; border-radius: var(--radius-sm);
    font-size: 14px; font-weight: 600; cursor: pointer;
    transition: background 0.15s, transform 0.05s;
  }
  .btn-primary:hover { background: #000; }
  .btn-primary:active { transform: translateY(1px); }
  .btn-primary:disabled { background: var(--ink-mute); cursor: not-allowed; }

  /* Status strip — single line under the composer, quiet */
  .status-strip {
    display: flex; flex-wrap: wrap; gap: 8px;
    margin: 16px 4px 0;
  }
  .status-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 999px;
    background: transparent; color: var(--ink-mute);
    font-size: 12px;
    transition: color 0.15s, background 0.15s;
  }
  .status-chip:hover { background: var(--surface); color: var(--ink-soft); }
  .status-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-mute); }
  .status-chip.on .dot { background: var(--ok); }
  .status-chip.off .dot { background: var(--ink-mute); }
  .status-chip.warn .dot { background: var(--warn); }

  /* Recent missions — small cards, max 3, more behind a link */
  .section-head {
    display: flex; justify-content: space-between; align-items: baseline;
    margin: 56px 4px 16px;
  }
  .section-title {
    font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.14em;
    color: var(--ink-mute);
  }
  .section-action {
    color: var(--ink-mute); font-size: 13px;
    transition: color 0.15s;
  }
  .section-action:hover { color: var(--ink); }

  .missions-empty {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: 24px;
    color: var(--ink-mute); font-size: 14px; text-align: center;
  }
  .mission-list { display: flex; flex-direction: column; gap: 8px; }
  .mission-row {
    display: block;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: 16px 20px;
    transition: border-color 0.15s, transform 0.05s, box-shadow 0.15s;
  }
  .mission-row:hover {
    border-color: var(--line-strong);
    box-shadow: var(--shadow-sm);
  }
  .mission-row:active { transform: translateY(1px); }
  .mission-row-top {
    display: flex; justify-content: space-between; align-items: center;
    gap: 12px; margin-bottom: 4px;
  }
  .mission-row-name {
    font-size: 15px; font-weight: 600; color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .mission-row-status {
    font-size: 11px; font-weight: 600;
    padding: 2px 9px; border-radius: 999px;
    background: #f5f3ee; color: var(--ink-mute);
    flex-shrink: 0;
  }
  .mission-row-status.active { background: #ebf6ec; color: var(--ok); }
  .mission-row-status.achieved { background: #fbf2d4; color: var(--accent); }
  .mission-row-status.needs-input { background: #fbe9e7; color: var(--bad); }
  .mission-row-status.paused { background: #fcefd9; color: var(--warn); }
  .mission-row-goal {
    color: var(--ink-soft); font-size: 13px; line-height: 1.5;
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }

  /* Toast */
  .toast {
    position: fixed; bottom: 24px; left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: var(--ink); color: #fff;
    padding: 10px 20px; border-radius: var(--radius-sm);
    font-size: 13px;
    box-shadow: var(--shadow-md);
    opacity: 0; pointer-events: none;
    transition: opacity 0.2s, transform 0.2s;
  }
  .toast.show {
    opacity: 1; transform: translateX(-50%) translateY(0);
  }
</style>
</head>
<body>
<div class="shell">
  <header class="topbar">
    <a class="brand" href="/dashboard"><span class="glyph">👾</span> Alien</a>
    <a class="gear" href="/settings" title="Settings" aria-label="Settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </a>
  </header>

  <div class="hero">
    <h1 class="hello" id="hello">Hello.</h1>
    <p class="hello-sub" id="hello-sub">Tell me what to build.</p>
  </div>

  <div class="composer">
    <div class="composer-label">New mission</div>
    <textarea
      id="mission"
      rows="2"
      placeholder="Ship a landing page for the new pricing tier. Or research the top 5 competitors. Or anything else."
    ></textarea>
    <div class="composer-row">
      <span class="composer-help">⌘ + Return to launch</span>
      <button id="launch" class="btn-primary">Launch</button>
    </div>
  </div>

  <div class="status-strip" id="status-strip"></div>

  <div class="section-head">
    <span class="section-title">Recent missions</span>
    <a class="section-action" href="/settings/missions" id="all-missions-link">View all →</a>
  </div>
  <div id="missions"><div class="missions-empty">Loading…</div></div>
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
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

let firstLoad = true;

async function loadState() {
  try {
    const r = await fetch("/v1/dashboard/state", { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("state " + r.status);
    const s = await r.json();
    render(s);
  } catch (err) {
    if (firstLoad) {
      $("hello-sub").textContent = "Could not reach the gateway.";
    }
  }
  firstLoad = false;
}

function render(s) {
  // Personal greeting — pulled from Soul. Falls back gracefully.
  const soulName = (s.soul && s.soul.name) || "Alien";
  $("hello").textContent = "Hello, I'm " + soulName + ".";
  const activeCount = (s.stats && s.stats.activeMissionCount) || 0;
  $("hello-sub").textContent = activeCount > 0
    ? "You have " + activeCount + " mission" + (activeCount === 1 ? "" : "s") + " in flight. Want to start another?"
    : "Tell me what to build.";

  // Status strip — quiet, scannable, each chip is clickable to a detail page.
  renderStatusStrip(s);

  // Recent missions — at most 3.
  renderMissions(s.projects || []);
}

function renderStatusStrip(s) {
  const chips = [];

  // Brain — show what model is in use, click to model picker
  const integrations = s.integrations || {};
  const brainStatus = (integrations.anthropic && integrations.anthropic.status !== "not-connected")
    || (integrations.openai && integrations.openai.status !== "not-connected")
    || (integrations.gemini && integrations.gemini.status !== "not-connected");
  chips.push({
    href: "/model",
    cls: brainStatus ? "on" : "warn",
    label: brainStatus ? "Brain connected" : "No brain — connect one",
  });

  // Experts
  const expertCount = (s.projects && s.projects[0] && s.projects[0].expertCount) || 84;
  chips.push({
    href: "/experts",
    cls: "on",
    label: expertCount + " experts ready",
  });

  // Channels
  const channels = s.channels || [];
  const channelsOn = channels.filter((c) => c.status === "enabled").length;
  chips.push({
    href: "/integrations",
    cls: channelsOn > 0 ? "on" : "off",
    label: channelsOn > 0 ? channelsOn + " channel" + (channelsOn === 1 ? "" : "s") : "No channels",
  });

  // Capability requests — only show if any pending
  const caps = (s.capabilities && s.capabilities.openCount) || 0;
  if (caps > 0) {
    chips.push({
      href: "/capabilities",
      cls: "warn",
      label: caps + " capability request" + (caps === 1 ? "" : "s"),
    });
  }

  $("status-strip").innerHTML = chips.map((c) =>
    '<a class="status-chip ' + c.cls + '" href="' + c.href + '"><span class="dot"></span>' + esc(c.label) + '</a>'
  ).join("");
}

function renderMissions(projects) {
  if (projects.length === 0) {
    $("missions").innerHTML = '<div class="missions-empty">No missions yet. Launch one above to get started.</div>';
    $("all-missions-link").style.display = "none";
    return;
  }
  $("all-missions-link").style.display = projects.length > 3 ? "" : "none";
  const recent = projects.slice(0, 3);
  $("missions").innerHTML = '<div class="mission-list">' + recent.map((p) => {
    const statusLabel = p.status === "active" ? "running" : p.status;
    return '<a class="mission-row" href="/mission/' + encodeURIComponent(p.id) + '">' +
      '<div class="mission-row-top">' +
        '<div class="mission-row-name">' + esc(p.name) + '</div>' +
        '<div class="mission-row-status ' + esc(p.status) + '">' + esc(statusLabel) + '</div>' +
      '</div>' +
      '<div class="mission-row-goal">' + esc(p.goal) + '</div>' +
    '</a>';
  }).join("") + '</div>';
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
    showToast("Mission launched");
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
