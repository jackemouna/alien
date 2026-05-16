import { promises as fsp } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { sendJson } from "./http-common.js";

/**
 * /settings — premium hub that brings every Alien settings surface
 * into one curated, light-themed page. Each card links to the detail
 * page that already exists (/soul, /integrations, /model, /capabilities,
 * /activity, /setup) plus a few read-only facts about the install
 * (workspace path, gateway port, state dir).
 *
 *   GET  /settings              — HTML
 *   GET  /v1/settings/state     — model + workspace + gateway info JSON
 *
 * Loopback-only. The dynamic chips (soul name, integrations status,
 * channel counts) reuse /v1/dashboard/state from dashboard-http so we
 * don't fan out into 5 different state endpoints.
 */

const PATHS = new Set(["/settings", "/v1/settings/state"]);

export function isSettingsPath(pathname: string): boolean {
  return PATHS.has(pathname);
}

export async function handleSettingsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isSettingsPath(pathname)) return false;
  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { error: { type: "forbidden", message: "Loopback-only" } });
    return true;
  }

  if (pathname === "/settings") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(renderSettingsHtml());
    return true;
  }

  if (pathname === "/v1/settings/state") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    sendJson(res, 200, await readSettingsState());
    return true;
  }

  return false;
}

// ---- state ----

type SettingsState = {
  readonly model: { provider?: string; id?: string };
  readonly workspace?: string;
  readonly stateDir: string;
  readonly gateway: { port: number; host: string };
};

async function readSettingsState(): Promise<SettingsState> {
  const stateDir = resolveStateDir(process.env);
  let workspace: string | undefined;
  let model: { provider?: string; id?: string } = {};
  try {
    const raw = await fsp.readFile(path.join(stateDir, "alien.json"), "utf8");
    const cfg = JSON.parse(raw) as {
      agents?: { defaults?: { workspace?: string; provider?: string; model?: string } };
    };
    workspace = cfg.agents?.defaults?.workspace;
    if (cfg.agents?.defaults?.provider || cfg.agents?.defaults?.model) {
      model = {
        provider: cfg.agents?.defaults?.provider,
        id: cfg.agents?.defaults?.model,
      };
    }
  } catch {
    // ignore — config not yet written
  }
  const port = Number(process.env.ALIEN_GATEWAY_PORT ?? 19001);
  return {
    model,
    workspace,
    stateDir,
    gateway: { port, host: `127.0.0.1:${port}` },
  };
}

// ---- helpers ----

function isLoopbackRequest(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.startsWith("::ffff:127.")
  );
}

// ---- HTML ----

function renderSettingsHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>👾 Alien · Settings</title>
<style>
  :root {
    color-scheme: light;
    --bg: #faf6ec;
    --bg-card: #ffffff;
    --line: #ece1c4;
    --line-strong: #d8c89d;
    --text: #1a1409;
    --text-dim: #5a5040;
    --text-mute: #8a7d62;
    --gold: #b89028;
    --gold-strong: #d9a936;
    --ok: #2b8a3e;
    --bad: #b8423a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.55 -apple-system, "SF Pro Text", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .shell { max-width: 1080px; padding: 48px 32px 80px; margin: 0 auto; }
  header.hero {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 24px; margin-bottom: 32px;
  }
  .brand { font-size: 26px; font-weight: 600; display: flex; align-items: center; gap: 12px; }
  .brand .glyph { font-size: 32px; }
  .subtitle { color: var(--text-mute); margin-top: 4px; font-size: 13px; }
  nav.quick { display: flex; gap: 8px; flex-wrap: wrap; }
  nav.quick a {
    text-decoration: none; color: var(--text-dim);
    background: var(--bg-card); border: 1px solid var(--line);
    padding: 8px 14px; border-radius: 8px; font-size: 13px;
    transition: color 0.15s, border-color 0.15s;
  }
  nav.quick a:hover { color: var(--gold); border-color: var(--line-strong); }

  h2.section {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em;
    color: var(--gold); margin: 32px 0 12px; font-weight: 600;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 14px;
  }
  a.card {
    text-decoration: none;
    display: block;
    background: var(--bg-card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 18px 20px;
    color: var(--text);
    transition: border-color 0.15s, transform 0.05s, box-shadow 0.15s;
    box-shadow: 0 1px 2px rgba(60,40,10,0.04);
  }
  a.card:hover {
    border-color: var(--line-strong);
    box-shadow: 0 6px 24px -10px rgba(184,144,40,0.18);
  }
  a.card:active { transform: translateY(1px); }
  .card .label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em;
    color: var(--gold); margin-bottom: 6px;
  }
  .card .title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
  .card .desc { color: var(--text-dim); font-size: 13px; line-height: 1.5; }
  .card .meta {
    margin-top: 10px; color: var(--text-mute); font-size: 12px;
    font-family: ui-monospace, "SF Mono", monospace;
  }

  .static-card {
    background: var(--bg-card); border: 1px solid var(--line);
    border-radius: 12px; padding: 18px 20px;
  }
  .static-card .label { font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.14em; color: var(--gold); margin-bottom: 6px; }
  .static-card .value {
    font-family: ui-monospace, "SF Mono", monospace; color: var(--text);
    font-size: 13px; word-break: break-all;
  }
  .static-card .hint { color: var(--text-mute); font-size: 12px; margin-top: 6px; }

  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: #faf5e4; padding: 3px 10px; border-radius: 999px;
    border: 1px solid var(--line); color: var(--text-dim); font-size: 12px;
    margin-right: 6px;
  }
  .chip .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-mute); }
  .chip.on .dot { background: var(--ok); }
  .chip.off .dot { background: var(--bad); }

  footer.foot {
    margin-top: 48px; color: var(--text-mute);
    font-size: 12px; text-align: center;
  }
</style>
</head>
<body>
<div class="shell">
  <header class="hero">
    <div>
      <div class="brand"><span class="glyph">👾</span> Settings</div>
      <div class="subtitle">Configure who Alien is and what it can reach.</div>
    </div>
    <nav class="quick">
      <a href="/dashboard">← Dashboard</a>
      <a href="/activity">Activity</a>
    </nav>
  </header>

  <h2 class="section">Identity & Intent</h2>
  <div class="grid">
    <a class="card" href="/soul">
      <div class="label">Soul</div>
      <div class="title">Who Alien is</div>
      <div class="desc">Name, role, tone, purpose. What Alien reads before every turn.</div>
      <div class="meta" id="soul-meta">Loading…</div>
    </a>
  </div>

  <h2 class="section">Models & Keys</h2>
  <div class="grid">
    <a class="card" href="/integrations">
      <div class="label">Integrations</div>
      <div class="title">Anthropic & OpenAI</div>
      <div class="desc">Connect, switch source, or disconnect each provider.</div>
      <div class="meta" id="integrations-meta">Loading…</div>
    </a>
    <a class="card" href="/model">
      <div class="label">Default model</div>
      <div class="title">Provider & model id</div>
      <div class="desc">Which model the workforce uses by default. Per-agent overrides live in alien.json.</div>
      <div class="meta" id="model-meta">Loading…</div>
    </a>
  </div>

  <h2 class="section">Channels & Capabilities</h2>
  <div class="grid">
    <a class="card" href="/setup">
      <div class="label">Channels</div>
      <div class="title">Inbound + outbound surfaces</div>
      <div class="desc">Slack, Discord, Telegram, WhatsApp, Gmail. Wire one up to make Alien reachable.</div>
      <div class="meta" id="channels-meta">Loading…</div>
    </a>
    <a class="card" href="/capabilities">
      <div class="label">Capabilities</div>
      <div class="title">Planner-raised requests</div>
      <div class="desc">When the workforce needs an integration it doesn't have, it lands here.</div>
      <div class="meta" id="caps-meta">Loading…</div>
    </a>
  </div>

  <h2 class="section">Install</h2>
  <div class="grid">
    <div class="static-card">
      <div class="label">Workspace</div>
      <div class="value" id="workspace-value">…</div>
      <div class="hint">The directory Alien reads SOUL.md / USER.md / IDENTITY.md from.</div>
    </div>
    <div class="static-card">
      <div class="label">State directory</div>
      <div class="value" id="statedir-value">…</div>
      <div class="hint">Secrets, projects, audit log, channel tokens. 0700 perms recommended.</div>
    </div>
    <div class="static-card">
      <div class="label">Gateway</div>
      <div class="value" id="gateway-value">…</div>
      <div class="hint">Loopback HTTP server. Restart with <code>pnpm alien gateway restart</code>.</div>
    </div>
  </div>

  <footer class="foot">Loopback-only · 👾 Alien · <span id="footer-host"></span></footer>
</div>

<script>
${settingsScript()}
</script>
</body>
</html>`;
}

function settingsScript(): string {
  return `
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

async function load() {
  $("footer-host").textContent = location.host;
  try {
    const [dashRes, setRes] = await Promise.all([
      fetch("/v1/dashboard/state"),
      fetch("/v1/settings/state"),
    ]);
    const dash = await dashRes.json();
    const settings = await setRes.json();
    render(dash, settings);
  } catch (err) {
    console.error(err);
  }
}

function render(d, s) {
  // Soul
  if (d.soul) {
    const role = d.soul.role || "your AI workforce";
    $("soul-meta").textContent = "name=" + d.soul.name + " · role=" + role + (d.soul.configured ? "" : " · using defaults");
  }
  // Integrations
  if (d.integrations) {
    const fmt = (id, info) => {
      const labels = {
        "claude-code-session": "Claude Code session",
        "wizard-oauth": "OAuth",
        "api-key": "API key",
        "not-connected": "not connected",
      };
      const cls = info.status === "not-connected" ? "off" : "on";
      return '<span class="chip ' + cls + '"><span class="dot"></span>' + escapeHtml(id) + ': ' + escapeHtml(labels[info.status] || info.status) + '</span>';
    };
    $("integrations-meta").innerHTML =
      fmt("Anthropic", d.integrations.anthropic) +
      fmt("OpenAI", d.integrations.openai);
  }
  // Channels
  if (d.channels) {
    const on = d.channels.filter((c) => c.status === "enabled").length;
    const off = d.channels.length - on;
    $("channels-meta").textContent =
      d.channels.length === 0
        ? "no channels wired yet"
        : on + " enabled · " + off + " disabled · " + d.channels.length + " total";
  }
  // Caps
  if (d.capabilities) {
    $("caps-meta").textContent =
      (d.capabilities.openCount || 0) + " open · " + d.capabilities.totalCount + " total";
  }
  // Model
  if (s.model && (s.model.provider || s.model.id)) {
    $("model-meta").textContent =
      (s.model.provider || "(provider?)") + " / " + (s.model.id || "(model?)");
  } else {
    $("model-meta").textContent = "using built-in default";
  }
  // Workspace / state / gateway
  $("workspace-value").textContent = s.workspace || "(not configured — defaults to a generated path)";
  $("statedir-value").textContent = s.stateDir;
  $("gateway-value").textContent = "http://" + s.gateway.host;
}

load();
`;
}
