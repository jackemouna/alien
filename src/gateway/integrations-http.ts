import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logWarn } from "../logger.js";
import {
  clearAnthropicOAuth,
  resolveAnthropicOAuthPath,
} from "../security/anthropic-oauth-store.js";
import {
  isClaudeCodeSessionAvailable,
  readClaudeCodeSession,
} from "../security/claude-code-session.js";
import { clearOpenAIOAuth, resolveOpenAIOAuthPath } from "../security/openai-oauth-store.js";
import { deleteKeychainSecret, detectKeychainBackend } from "../security/os-keychain.js";
import { readSecretFromEnvOrKeychain } from "../security/secret-source.js";
import { sendJson } from "./http-common.js";

/**
 * /integrations — the ongoing "edit AI keys and connections" surface,
 * separate from /setup (which is framed as first-run). Two cards in
 * v0.1: Anthropic + OpenAI. Each card shows what's currently active
 * (Claude Code session, wizard OAuth, API key, or none) and lets the
 * operator update or disconnect without re-doing the whole setup flow.
 *
 *   GET  /integrations          — HTML page
 *   GET  /v1/integrations       — current state of each provider
 *   POST /v1/integrations/:provider/disconnect — clear all auth for X
 *
 * Validation + save reuse the existing /v1/setup endpoints
 * (validate-anthropic-key, validate-openai-key, save-keys, oauth/start,
 * oauth/poll). The page's inline JS calls those directly — no
 * duplication.
 *
 * Loopback-only.
 */

const ANTHROPIC_KEYCHAIN = { service: "alien.ai", account: "anthropic-api-key" } as const;
const OPENAI_KEYCHAIN = { service: "alien.ai", account: "openai-api-key" } as const;

const PATHS = new Set([
  "/integrations",
  "/v1/integrations",
  "/v1/integrations/anthropic/disconnect",
  "/v1/integrations/openai/disconnect",
]);

export function isIntegrationsPath(pathname: string): boolean {
  return PATHS.has(pathname);
}

export async function handleIntegrationsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isIntegrationsPath(pathname)) return false;
  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { error: { type: "forbidden", message: "Loopback-only" } });
    return true;
  }

  if (pathname === "/integrations") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(renderHtml());
    return true;
  }

  if (pathname === "/v1/integrations") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    sendJson(res, 200, await readIntegrationsState());
    return true;
  }

  if (
    pathname === "/v1/integrations/anthropic/disconnect" ||
    pathname === "/v1/integrations/openai/disconnect"
  ) {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end();
      return true;
    }
    const provider = pathname.includes("anthropic") ? "anthropic" : "openai";
    try {
      const cleared = await disconnectProvider(provider);
      sendJson(res, 200, {
        ok: true,
        cleared,
        message: `${provider} disconnected. The agent runtime will fail to use it until you re-connect.`,
      });
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  return false;
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

// ---- state read ----

type ProviderState = {
  readonly id: "anthropic" | "openai";
  readonly label: string;
  readonly status: "claude-code-session" | "wizard-oauth" | "api-key" | "not-connected";
  readonly statusLabel: string;
  readonly statusDetail?: string;
  readonly billingHint?: string;
};

async function readIntegrationsState(): Promise<{
  readonly providers: ReadonlyArray<ProviderState>;
  readonly keychainAvailable: boolean;
}> {
  const backend = detectKeychainBackend();

  // Anthropic priority: Claude Code session > wizard OAuth > API key
  let anthropicState: ProviderState;
  const cc = readClaudeCodeSession();
  if (cc) {
    anthropicState = {
      id: "anthropic",
      label: "Anthropic (Claude)",
      status: "claude-code-session",
      statusLabel: "Connected via Claude Code session",
      ...(cc.subscriptionType ? { statusDetail: `Subscription tier: ${cc.subscriptionType}` } : {}),
      billingHint:
        "Anthropic currently bills third-party-app inference against your 'extra usage' pool, not the Pro/Max plan. Top up at claude.ai/settings/usage if calls fail with a billing error.",
    };
  } else {
    const hasAnthropicOAuth = await fileExists(resolveAnthropicOAuthPath());
    const anthropicKey = readSecretFromEnvOrKeychain({
      envVarName: "ANTHROPIC_API_KEY",
      keychain: ANTHROPIC_KEYCHAIN,
      keychainGate: "always",
    });
    if (hasAnthropicOAuth) {
      anthropicState = {
        id: "anthropic",
        label: "Anthropic (Claude)",
        status: "wizard-oauth",
        statusLabel: "Connected via wizard OAuth",
        statusDetail: "Same token shape as Claude Code; bills against the extra-usage pool.",
        billingHint:
          "If calls fail with a billing error, top up at claude.ai/settings/usage or paste an API key below.",
      };
    } else if (anthropicKey) {
      anthropicState = {
        id: "anthropic",
        label: "Anthropic (Claude)",
        status: "api-key",
        statusLabel: "Connected via API key",
        statusDetail: "Pay-per-token billing.",
      };
    } else {
      anthropicState = {
        id: "anthropic",
        label: "Anthropic (Claude)",
        status: "not-connected",
        statusLabel: "Not connected",
      };
    }
  }

  // OpenAI priority: wizard OAuth > API key
  let openaiState: ProviderState;
  const hasOpenAIOAuth = await fileExists(resolveOpenAIOAuthPath());
  const openaiKey = readSecretFromEnvOrKeychain({
    envVarName: "OPENAI_API_KEY",
    keychain: OPENAI_KEYCHAIN,
    keychainGate: "always",
  });
  if (hasOpenAIOAuth) {
    openaiState = {
      id: "openai",
      label: "OpenAI (ChatGPT / GPT)",
      status: "wizard-oauth",
      statusLabel: "Connected via ChatGPT Codex OAuth",
      statusDetail:
        "Note: subscription OAuth grants Codex scopes only — agent inference at /v1/responses needs an API key.",
    };
  } else if (openaiKey) {
    openaiState = {
      id: "openai",
      label: "OpenAI (ChatGPT / GPT)",
      status: "api-key",
      statusLabel: "Connected via API key",
      statusDetail: "Pay-per-token billing. Required for /v1/responses agent inference.",
    };
  } else {
    openaiState = {
      id: "openai",
      label: "OpenAI (ChatGPT / GPT)",
      status: "not-connected",
      statusLabel: "Not connected",
    };
  }

  return {
    providers: [anthropicState, openaiState],
    keychainAvailable: backend.available,
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---- disconnect ----

async function disconnectProvider(provider: "anthropic" | "openai"): Promise<{
  readonly keychain: boolean;
  readonly oauthFile: boolean;
  readonly authProfiles: ReadonlyArray<string>;
}> {
  const result = { keychain: false, oauthFile: false, authProfiles: [] as string[] };
  // 1. Keychain entry
  try {
    const ok = deleteKeychainSecret(
      provider === "anthropic" ? ANTHROPIC_KEYCHAIN : OPENAI_KEYCHAIN,
    );
    result.keychain = ok;
  } catch (err) {
    logWarn(
      `integrations: keychain delete failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // 2. Wizard OAuth file
  try {
    if (provider === "anthropic") {
      await clearAnthropicOAuth();
    } else {
      await clearOpenAIOAuth();
    }
    result.oauthFile = true;
  } catch {
    // already absent — fine
  }
  // 3. Remove all profiles for this provider from every agent's
  // auth-profiles.json. The Claude Code session profile gets removed
  // here too — operator can re-detect it by reconnecting / restarting.
  try {
    const cleared = await removeProviderFromAuthProfiles(provider);
    (result.authProfiles as string[]).push(...cleared);
  } catch (err) {
    logWarn(
      `integrations: auth-profiles update failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return result;
}

async function removeProviderFromAuthProfiles(provider: "anthropic" | "openai"): Promise<string[]> {
  const stateDir = resolveStateDir();
  const agentsRoot = path.join(stateDir, "agents");
  let agentIds: string[];
  try {
    const entries = await fs.readdir(agentsRoot, { withFileTypes: true });
    agentIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const touched: string[] = [];
  for (const id of agentIds) {
    const filePath = path.join(agentsRoot, id, "agent", "auth-profiles.json");
    let parsed: { version?: number; profiles?: Record<string, { provider?: unknown }> };
    try {
      const raw = await fs.readFile(filePath, "utf8");
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed.profiles || typeof parsed.profiles !== "object") continue;
    const next: Record<string, unknown> = {};
    let removedAny = false;
    for (const [pid, profile] of Object.entries(parsed.profiles)) {
      if ((profile as { provider?: string }).provider === provider) {
        removedAny = true;
        continue;
      }
      next[pid] = profile;
    }
    if (removedAny) {
      const out = { version: parsed.version ?? 1, profiles: next };
      await fs.writeFile(filePath, `${JSON.stringify(out, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      touched.push(id);
    }
  }
  return touched;
}

// ---- HTML page ----

function renderHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Integrations · Alien</title>
<style>${CSS}</style>
</head><body>
<div class="page">
  <p class="crumb"><a href="/">← Alien</a></p>
  <h1>👾 Integrations</h1>
  <p class="tag">AI providers your Alien talks to. Edit a key, swap providers, or disconnect — no need to redo the whole setup.</p>

  <div id="cards" class="cards"></div>

  <div id="status" class="status"></div>
</div>
${script()}
</body></html>`;
}

const CSS = `
  :root {
    --bg: #faf8f4; --ink: #1a1714; --muted: #6b6258; --line: #e6dfd2;
    --gold: #b8923c; --gold-deep: #8e6e22; --ok: #2f7a4b; --err: #b53939;
    --field: #fff; --code-bg: #f4ecd9;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 32px 20px 80px; }
  .page { max-width: 720px; margin: 0 auto; }
  .crumb { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
  .crumb a { color: var(--gold-deep); text-decoration: none; }
  .crumb a:hover { text-decoration: underline; }
  h1 { font-size: 28px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 4px; }
  .tag { color: var(--muted); margin: 0 0 22px; font-size: 14px; }
  .cards { display: flex; flex-direction: column; gap: 14px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 12px;
    padding: 20px 22px; }
  .card.connected { border-color: #c4e3cd; background: #f6fbf7; }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 6px; }
  .card-name { font-weight: 600; font-size: 17px; margin: 0; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 11px;
    font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .badge.connected { background: #ddeede; color: var(--ok); }
  .badge.partial { background: #fbf3e2; color: var(--gold-deep); }
  .badge.not-connected { background: #f0ece4; color: var(--muted); }
  .status-line { font-size: 13px; color: var(--muted); margin: 0 0 4px; }
  .detail { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
  .hint { background: #fbf6e8; border-left: 3px solid var(--gold); padding: 8px 12px;
    margin: 8px 0; border-radius: 6px; font-size: 12px; color: #695420; }
  .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 12px 0 0; }
  input[type="password"], input[type="text"] {
    flex: 1; min-width: 180px; padding: 9px 11px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--field); font: inherit; color: var(--ink); font-size: 14px; }
  input:focus { outline: 2px solid var(--gold); outline-offset: -1px; border-color: var(--gold); }
  button.btn { padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px;
    background: #fff; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
    color: var(--ink); }
  button.btn:hover { border-color: var(--gold); }
  button.btn:disabled { opacity: .5; cursor: default; }
  button.btn.primary { background: var(--ink); color: #fff; border-color: var(--ink); }
  button.btn.primary:hover { background: var(--gold-deep); border-color: var(--gold-deep); }
  button.btn.danger { color: var(--err); border-color: #f4caca; }
  button.btn.danger:hover { background: #fdecec; border-color: var(--err); }
  .row-label { font-size: 13px; font-weight: 600; color: var(--ink); margin: 0 0 4px; }
  .row { margin: 12px 0 0; }
  .help { font-size: 12px; color: var(--muted); margin: 6px 0 0; }
  .help a { color: var(--gold-deep); }
  .field-feedback { font-size: 12px; margin: 4px 0 0; min-height: 16px; }
  .field-feedback.ok { color: var(--ok); }
  .field-feedback.err { color: var(--err); }
  .status { margin-top: 18px; font-size: 14px; color: var(--muted); min-height: 22px; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }
`;

function script(): string {
  return `<script>
(() => {
  const $ = (id) => document.getElementById(id);
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  async function fetchJson(p, init) {
    const r = await fetch(p, init || {});
    let d = null; try { d = await r.json(); } catch {}
    return { status: r.status, data: d };
  }

  function badgeFor(status) {
    if (status === 'claude-code-session' || status === 'wizard-oauth' || status === 'api-key') return 'connected';
    if (status === 'wizard-oauth') return 'partial';
    return 'not-connected';
  }

  function placeholderFor(provider) {
    return provider === 'anthropic' ? 'sk-ant-…' : 'sk-…';
  }

  function getKeyLink(provider) {
    return provider === 'anthropic'
      ? 'https://console.anthropic.com/settings/keys'
      : 'https://platform.openai.com/api-keys';
  }

  function renderCard(p) {
    const cls = p.status !== 'not-connected' ? 'connected' : '';
    const badge = badgeFor(p.status);
    return [
      '<div class="card ' + cls + '" data-provider="' + esc(p.id) + '">',
        '<div class="card-head">',
          '<p class="card-name">' + esc(p.label) + '</p>',
          '<span class="badge ' + badge + '">' + (p.status === 'not-connected' ? 'not connected' : 'connected') + '</span>',
        '</div>',
        '<div class="status-line">' + esc(p.statusLabel) + '</div>',
        p.statusDetail ? '<div class="detail">' + esc(p.statusDetail) + '</div>' : '',
        p.billingHint ? '<div class="hint">' + esc(p.billingHint) + '</div>' : '',
        '<div class="row">',
          '<div class="row-label">Update API key</div>',
          '<div class="actions">',
            '<input type="password" data-key-input="' + esc(p.id) + '" placeholder="' + placeholderFor(p.id) + '" autocomplete="off">',
            '<button class="btn" data-test="' + esc(p.id) + '" type="button">Test</button>',
            '<button class="btn primary" data-save="' + esc(p.id) + '" type="button">Save</button>',
          '</div>',
          '<div class="field-feedback" data-feedback="' + esc(p.id) + '"></div>',
          '<div class="help">Get a key at <a href="' + getKeyLink(p.id) + '" target="_blank" rel="noopener">' + getKeyLink(p.id) + '</a></div>',
        '</div>',
        p.status !== 'not-connected'
          ? '<div class="row"><button class="btn danger" data-disconnect="' + esc(p.id) + '" type="button">Disconnect ' + esc(p.label) + '</button></div>'
          : '',
      '</div>',
    ].join('');
  }

  async function load() {
    const r = await fetchJson('/v1/integrations', { method: 'GET' });
    if (!r.data) {
      $("status").className = "status err";
      $("status").textContent = "Failed to load.";
      return;
    }
    $("cards").innerHTML = (r.data.providers || []).map(renderCard).join('');
    bind();
  }

  function bind() {
    document.querySelectorAll('button[data-test]').forEach((b) => {
      b.addEventListener('click', () => testKey(b.getAttribute('data-test')));
    });
    document.querySelectorAll('button[data-save]').forEach((b) => {
      b.addEventListener('click', () => saveKey(b.getAttribute('data-save')));
    });
    document.querySelectorAll('button[data-disconnect]').forEach((b) => {
      b.addEventListener('click', () => disconnect(b.getAttribute('data-disconnect')));
    });
  }

  function setFeedback(provider, kind, msg) {
    const el = document.querySelector('div[data-feedback="' + provider + '"]');
    if (!el) return;
    el.className = 'field-feedback' + (kind ? ' ' + kind : '');
    el.textContent = msg || '';
  }

  async function testKey(provider) {
    const input = document.querySelector('input[data-key-input="' + provider + '"]');
    if (!input) return;
    const apiKey = input.value.trim();
    if (!apiKey) { setFeedback(provider, 'err', 'Paste a key first.'); return; }
    setFeedback(provider, '', 'Testing…');
    const r = await fetchJson('/v1/setup/validate-' + provider + '-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (r.data && r.data.ok) setFeedback(provider, 'ok', '✓ Looks good — click Save to apply.');
    else setFeedback(provider, 'err', (r.data && (r.data.error || r.data.message)) || 'Could not validate.');
  }

  async function saveKey(provider) {
    const input = document.querySelector('input[data-key-input="' + provider + '"]');
    if (!input) return;
    const apiKey = input.value.trim();
    if (!apiKey) { setFeedback(provider, 'err', 'Paste a key first.'); return; }
    setFeedback(provider, '', 'Saving…');
    const payload = provider === 'anthropic' ? { anthropicKey: apiKey } : { openaiKey: apiKey };
    const r = await fetchJson('/v1/setup/save-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.data && r.data.ok) {
      setFeedback(provider, 'ok', '✓ Saved. Active for the next agent call.');
      input.value = '';
      load();
    } else {
      setFeedback(provider, 'err', (r.data && r.data.error) || 'Save failed.');
    }
  }

  async function disconnect(provider) {
    if (!window.confirm('Disconnect ' + provider + '? This removes the keychain entry, the wizard OAuth file, and the agent auth profile.')) return;
    const r = await fetchJson('/v1/integrations/' + provider + '/disconnect', { method: 'POST' });
    if (r.data && r.data.ok) {
      $("status").className = "status ok";
      $("status").textContent = r.data.message || 'Disconnected.';
      load();
    } else {
      $("status").className = "status err";
      $("status").textContent = (r.data && r.data.error) || 'Disconnect failed.';
    }
  }

  load();
})();
</script>`;
}
