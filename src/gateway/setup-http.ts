import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logWarn } from "../logger.js";
import {
  writeAnthropicOAuth,
  type AnthropicOAuthCredentials,
} from "../security/anthropic-oauth-store.js";
import { writeOpenAIOAuth, type OpenAIOAuthCredentials } from "../security/openai-oauth-store.js";
import { detectKeychainBackend, setKeychainSecret } from "../security/os-keychain.js";
import { readSecretFromEnvOrKeychain } from "../security/secret-source.js";
import type { ResolvedGatewayAuth } from "./auth-resolve.js";
import { readJsonBodyOrError, sendInvalidRequest, sendJson } from "./http-common.js";

/**
 * First-run setup wizard, served as a standalone HTML page. Two paths
 * for each provider:
 *
 *   - "Sign in with Claude" / "Sign in with ChatGPT" — OAuth flows that
 *     bill inference against the user's Pro/Max / Plus subscription
 *     instead of metered API. Tokens are saved to a local JSON file at
 *     `~/.alien/<provider>-oauth.json` and auto-refreshed by the LLM
 *     client when nearing expiry.
 *   - "Paste an API key" — the fallback for users without a subscription
 *     or who prefer pay-per-use. Saved to the OS keychain.
 *
 * Auth: the wizard endpoints are loopback-only and never require a
 * bearer token, because the user is configuring the gateway *before* a
 * token exists.
 *
 * Routes:
 *   GET  /setup                              — the wizard HTML
 *   POST /v1/setup/status                    — { anthropic, openai, ... }
 *   POST /v1/setup/validate-anthropic-key    — test an API key live
 *   POST /v1/setup/validate-openai-key       — test an API key live
 *   POST /v1/setup/save-keys                 — persist API keys to keychain
 *   POST /v1/setup/oauth/start               — { provider } -> { sessionId, authUrl }
 *   GET  /v1/setup/oauth/poll?sessionId=...  — wizard polls; returns
 *                                              "pending" | "complete" | "error"
 */

const ANTHROPIC_KEYCHAIN = { service: "alien.ai", account: "anthropic-api-key" } as const;
const OPENAI_KEYCHAIN = { service: "alien.ai", account: "openai-api-key" } as const;

type OAuthProvider = "anthropic" | "openai";

type OAuthSession = {
  readonly id: string;
  readonly provider: OAuthProvider;
  readonly startedAt: number;
  status: "pending" | "complete" | "error";
  authUrl?: string;
  error?: string;
};

// In-memory only — sessions are short-lived and tied to one wizard tab.
const OAUTH_SESSIONS = new Map<string, OAuthSession>();
const OAUTH_SESSION_TTL_MS = 10 * 60_000;

function gcOAuthSessions(): void {
  const cutoff = Date.now() - OAUTH_SESSION_TTL_MS;
  for (const [id, sess] of OAUTH_SESSIONS) {
    if (sess.startedAt < cutoff) OAUTH_SESSIONS.delete(id);
  }
}

const SETUP_PATHS = new Set([
  "/setup",
  "/v1/setup/status",
  "/v1/setup/validate-anthropic-key",
  "/v1/setup/validate-openai-key",
  "/v1/setup/save-keys",
  "/v1/setup/oauth/start",
  "/v1/setup/oauth/poll",
]);

export function isSetupPath(pathname: string): boolean {
  return SETUP_PATHS.has(pathname);
}

/**
 * True when `/` should redirect to `/setup` because no Anthropic credentials
 * are configured. Lets first-run users land in the wizard instead of the
 * gateway-token wall.
 */
export function isFirstRun(): boolean {
  const status = readSetupStatus();
  return !status.anthropic.configured;
}

export type SetupRequestOptions = {
  readonly resolvedAuth?: ResolvedGatewayAuth;
};

export async function handleSetupRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: SetupRequestOptions = {},
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isSetupPath(pathname)) return false;

  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, {
      error: { type: "forbidden", message: "Setup is only reachable from localhost" },
    });
    return true;
  }

  if (pathname === "/setup") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    sendHtml(res, 200, renderSetupHtml());
    return true;
  }

  if (pathname === "/v1/setup/oauth/poll") {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    const sessionId = url.searchParams.get("sessionId") ?? "";
    return handleOAuthPoll(res, sessionId);
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return true;
  }

  if (pathname === "/v1/setup/status") {
    sendJson(res, 200, {
      ...readSetupStatus(),
      gatewayToken: options.resolvedAuth?.token ?? null,
    });
    return true;
  }

  const body = (await readJsonBodyOrError(req, res, 4096)) as
    | {
        readonly apiKey?: unknown;
        readonly anthropicKey?: unknown;
        readonly openaiKey?: unknown;
        readonly provider?: unknown;
      }
    | undefined;
  if (body === undefined) return true;

  if (pathname === "/v1/setup/validate-anthropic-key") {
    const key = readKey(body.apiKey ?? body.anthropicKey);
    if (!key) return badRequest(res, "Missing apiKey");
    const result = await validateAnthropicKey(key);
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (pathname === "/v1/setup/validate-openai-key") {
    const key = readKey(body.apiKey ?? body.openaiKey);
    if (!key) return badRequest(res, "Missing apiKey");
    const result = await validateOpenAiKey(key);
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (pathname === "/v1/setup/save-keys") {
    const anthropic = readKey(body.anthropicKey);
    const openai = readKey(body.openaiKey);
    if (!anthropic && !openai) {
      return badRequest(res, "Provide at least anthropicKey or openaiKey");
    }
    const result = saveApiKeys({ anthropic, openai });
    sendJson(res, result.ok ? 200 : 500, result);
    return true;
  }

  if (pathname === "/v1/setup/oauth/start") {
    const provider = String(body.provider ?? "");
    if (provider !== "anthropic" && provider !== "openai") {
      return badRequest(res, "provider must be 'anthropic' or 'openai'");
    }
    const session = startOAuthFlow(provider);
    // Reply once the authUrl is captured.
    await waitForAuthUrl(session, 5000);
    if (session.status === "error") {
      sendJson(res, 500, { ok: false, error: session.error ?? "OAuth start failed" });
      return true;
    }
    sendJson(res, 200, { ok: true, sessionId: session.id, authUrl: session.authUrl });
    return true;
  }

  return false;
}

function handleOAuthPoll(res: ServerResponse, sessionId: string): true {
  gcOAuthSessions();
  const session = OAUTH_SESSIONS.get(sessionId);
  if (!session) {
    sendJson(res, 404, { ok: false, error: "Unknown sessionId" });
    return true;
  }
  if (session.status === "pending") {
    sendJson(res, 200, { status: "pending" });
    return true;
  }
  if (session.status === "error") {
    sendJson(res, 200, { status: "error", error: session.error ?? "Unknown error" });
    return true;
  }
  sendJson(res, 200, { status: "complete", provider: session.provider });
  return true;
}

function startOAuthFlow(provider: OAuthProvider): OAuthSession {
  gcOAuthSessions();
  const session: OAuthSession = {
    id: randomUUID(),
    provider,
    startedAt: Date.now(),
    status: "pending",
  };
  OAUTH_SESSIONS.set(session.id, session);
  runOAuthFlow(session).catch((err) => {
    session.status = "error";
    session.error = err instanceof Error ? err.message : String(err);
    logWarn(`setup oauth ${provider}: ${session.error}`);
  });
  return session;
}

async function runOAuthFlow(session: OAuthSession): Promise<void> {
  const { loginAnthropic, loginOpenAICodex } = await import("@mariozechner/pi-ai/oauth");
  const onAuth = ({ url }: { url: string; instructions?: string }) => {
    session.authUrl = url;
  };
  const onPrompt = async () => "";

  if (session.provider === "anthropic") {
    const creds = await loginAnthropic({ onAuth, onPrompt });
    const next: AnthropicOAuthCredentials = {
      access: creds.access,
      refresh: creds.refresh,
      expires: creds.expires,
    };
    await writeAnthropicOAuth(next);
    session.status = "complete";
    return;
  }
  const creds = await loginOpenAICodex({ onAuth, onPrompt });
  const next: OpenAIOAuthCredentials = {
    access: creds.access,
    refresh: creds.refresh,
    expires: creds.expires,
  };
  await writeOpenAIOAuth(next);
  session.status = "complete";
}

async function waitForAuthUrl(session: OAuthSession, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (session.authUrl) return;
    if (session.status === "error") return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function badRequest(res: ServerResponse, message: string): true {
  sendInvalidRequest(res, message);
  return true;
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

function readKey(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

type ValidationResult =
  | { readonly ok: true; readonly model?: string }
  | { readonly ok: false; readonly error: string };

async function validateAnthropicKey(key: string): Promise<ValidationResult> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (res.ok) return { ok: true, model: "claude-haiku-4-5" };
    const text = await res.text().catch(() => "");
    return { ok: false, error: explainHttpError(res.status, text, "Anthropic") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function validateOpenAiKey(key: string): Promise<ValidationResult> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { authorization: `Bearer ${key}` },
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    return { ok: false, error: explainHttpError(res.status, text, "OpenAI") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function explainHttpError(status: number, body: string, provider: string): string {
  if (status === 401 || status === 403) {
    return `${provider} rejected the key (HTTP ${status}). Double-check you copied the whole thing.`;
  }
  if (status === 429) {
    return `${provider} rate-limited the validation call. Wait a moment and try again.`;
  }
  if (status >= 500) {
    return `${provider} returned a server error (HTTP ${status}). Try again in a moment.`;
  }
  return `${provider} returned HTTP ${status}: ${body.slice(0, 200)}`;
}

type SaveResult =
  | { readonly ok: true; readonly savedTo: "keychain" | "env-only"; readonly providers: string[] }
  | { readonly ok: false; readonly error: string };

function saveApiKeys(keys: { anthropic?: string; openai?: string }): SaveResult {
  const providers: string[] = [];
  const backend = detectKeychainBackend();
  const useKeychain = backend.available;
  try {
    if (keys.anthropic) {
      if (useKeychain) setKeychainSecret(ANTHROPIC_KEYCHAIN, keys.anthropic);
      process.env.ANTHROPIC_API_KEY = keys.anthropic;
      providers.push("anthropic");
    }
    if (keys.openai) {
      if (useKeychain) setKeychainSecret(OPENAI_KEYCHAIN, keys.openai);
      process.env.OPENAI_API_KEY = keys.openai;
      providers.push("openai");
    }
    return { ok: true, savedTo: useKeychain ? "keychain" : "env-only", providers };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type SetupStatus = {
  readonly anthropic: { readonly configured: boolean; readonly source: string };
  readonly openai: { readonly configured: boolean; readonly source: string };
  readonly keychainAvailable: boolean;
};

function readSetupStatus(): SetupStatus {
  const anthropicKey = readSecretFromEnvOrKeychain({
    envVarName: "ANTHROPIC_API_KEY",
    keychain: ANTHROPIC_KEYCHAIN,
    keychainGate: "always",
  });
  const openaiKey = readSecretFromEnvOrKeychain({
    envVarName: "OPENAI_API_KEY",
    keychain: OPENAI_KEYCHAIN,
    keychainGate: "always",
  });
  const anthropicOAuth = oauthFileExists("anthropic-oauth.json");
  const openaiOAuth = oauthFileExists("openai-oauth.json");
  const backend = detectKeychainBackend();
  return {
    anthropic: {
      configured: Boolean(anthropicKey) || anthropicOAuth,
      source: anthropicOAuth ? "subscription" : anthropicKey ? "api-key" : "none",
    },
    openai: {
      configured: Boolean(openaiKey) || openaiOAuth,
      source: openaiOAuth ? "subscription" : openaiKey ? "api-key" : "none",
    },
    keychainAvailable: backend.available,
  };
}

function oauthFileExists(fileName: string): boolean {
  // Synchronous existence check — readSetupStatus is called from request
  // hot paths and the redirect decision. Falling back to false on any
  // error keeps the wizard reachable.
  try {
    return existsSync(path.join(resolveStateDir(), fileName));
  } catch {
    return false;
  }
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

function renderSetupHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set up Alien</title>
<style>
  :root {
    --bg: #faf8f4;
    --ink: #1a1714;
    --muted: #6b6258;
    --line: #e6dfd2;
    --gold: #b8923c;
    --gold-deep: #8e6e22;
    --ok: #2f7a4b;
    --err: #b53939;
    --field: #fff;
    --claude: #c96442;
    --openai: #10a37f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 32px 20px;
  }
  .card {
    max-width: 600px; width: 100%; background: #fff; border: 1px solid var(--line);
    border-radius: 16px; padding: 36px 36px 32px; box-shadow: 0 4px 22px rgba(0,0,0,.04);
  }
  .brand { font-size: 30px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 4px; }
  .tag { color: var(--muted); margin: 0 0 28px; font-size: 15px; }
  .provider {
    border: 1px solid var(--line); border-radius: 12px;
    padding: 18px 18px 16px; margin: 0 0 16px;
  }
  .provider.connected { border-color: var(--ok); background: #f6fbf7; }
  .provider-head { display: flex; align-items: center; justify-content: space-between; margin: 0 0 12px; }
  .provider-name { font-size: 17px; font-weight: 600; margin: 0; }
  .badge { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 99px;
    text-transform: uppercase; letter-spacing: .04em; }
  .badge.required { background: #fbf3e2; color: var(--gold-deep); }
  .badge.optional { background: #f0ece4; color: var(--muted); }
  .badge.connected { background: #ddeede; color: var(--ok); }
  .recommend {
    background: #fbf6e8; border-left: 3px solid var(--gold); padding: 10px 14px;
    margin: 0 0 14px; border-radius: 6px; font-size: 14px; color: #695420;
  }
  .recommend strong { color: var(--ink); }
  button {
    padding: 10px 16px; border: 1px solid var(--line); border-radius: 8px;
    background: #fff; font: inherit; font-weight: 500; cursor: pointer; color: var(--ink);
  }
  button:hover { border-color: var(--gold); }
  button:disabled { opacity: .5; cursor: default; }
  button.signin {
    width: 100%; padding: 13px 18px; margin: 0 0 12px; font-size: 15px; font-weight: 600;
  }
  button.signin.anthropic { background: var(--claude); color: #fff; border-color: var(--claude); }
  button.signin.anthropic:hover { background: #b75839; border-color: #b75839; }
  button.signin.openai { background: var(--openai); color: #fff; border-color: var(--openai); }
  button.signin.openai:hover { background: #0e8d6c; border-color: #0e8d6c; }
  .divider { text-align: center; color: var(--muted); margin: 12px 0 10px;
    font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  .api-input { display: flex; gap: 6px; margin: 0 0 4px; }
  input[type="password"], input[type="text"] {
    flex: 1; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--field); font: inherit; color: var(--ink);
  }
  input:focus { outline: 2px solid var(--gold); outline-offset: -1px; border-color: var(--gold); }
  .help { font-size: 13px; color: var(--muted); margin: 4px 0 0; }
  .help a { color: var(--gold-deep); text-decoration: underline; }
  .status { font-size: 13px; margin: 6px 0 0; min-height: 18px; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }
  .status.info { color: var(--muted); }
  .primary {
    background: var(--ink); color: #fff; border-color: var(--ink);
    padding: 14px 22px; font-size: 15px; font-weight: 600; width: 100%; margin-top: 6px;
  }
  .primary:hover { background: var(--gold-deep); border-color: var(--gold-deep); }
  .footer { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line);
    font-size: 12px; color: var(--muted); }
  .err-banner { background: #fdecec; border: 1px solid #f4caca; color: var(--err);
    padding: 10px 12px; border-radius: 8px; margin: 12px 0 0; font-size: 14px; display: none; }
  .err-banner.show { display: block; }
</style>
</head>
<body>
  <div class="card">
    <h1 class="brand">👾 Welcome to Alien</h1>
    <p class="tag">Sign in with what you already pay for. 60 seconds.</p>

    <div class="provider" id="anthropic-card">
      <div class="provider-head">
        <h2 class="provider-name">Claude (Anthropic)</h2>
        <span class="badge required" id="anthropic-badge">required</span>
      </div>
      <div class="recommend">
        <strong>Got Claude Pro or Max?</strong> Sign in below — Alien will run on your subscription instead of metered API.
      </div>
      <button id="anthropic-signin" class="signin anthropic" type="button">
        Sign in with Claude
      </button>
      <div id="anthropic-oauth-status" class="status"></div>
      <div class="divider">— or —</div>
      <label for="anthropic-key" style="display:block;font-size:13px;color:var(--muted);margin:0 0 4px;">Paste an Anthropic API key (pay-per-use)</label>
      <div class="api-input">
        <input id="anthropic-key" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
        <button id="anthropic-validate" type="button">Test</button>
      </div>
      <div id="anthropic-key-status" class="status"></div>
      <p class="help">Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
    </div>

    <div class="provider" id="openai-card">
      <div class="provider-head">
        <h2 class="provider-name">ChatGPT (OpenAI)</h2>
        <span class="badge optional" id="openai-badge">optional</span>
      </div>
      <div class="recommend">
        <strong>Got ChatGPT Plus or Pro?</strong> Sign in below — Alien will use your ChatGPT subscription for OpenAI calls. Skip this if you don't have one.
      </div>
      <button id="openai-signin" class="signin openai" type="button">
        Sign in with ChatGPT
      </button>
      <div id="openai-oauth-status" class="status"></div>
      <div class="divider">— or —</div>
      <label for="openai-key" style="display:block;font-size:13px;color:var(--muted);margin:0 0 4px;">Paste an OpenAI API key (pay-per-use)</label>
      <div class="api-input">
        <input id="openai-key" type="password" placeholder="sk-..." autocomplete="off" spellcheck="false">
        <button id="openai-validate" type="button">Test</button>
      </div>
      <div id="openai-key-status" class="status"></div>
      <p class="help">Get one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>.</p>
    </div>

    <button id="save" class="primary" type="button">Start Alien</button>
    <div id="save-error" class="err-banner"></div>

    <div class="footer">
      Subscription tokens live in <code>~/.alien/&lt;provider&gt;-oauth.json</code> (mode 600) and auto-refresh. API keys go in your OS keychain. Nothing leaves your machine.
    </div>
  </div>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const setStatus = (id, kind, msg) => {
    const el = $(id);
    el.className = "status" + (kind ? " " + kind : "");
    el.textContent = msg || "";
  };
  const validatedKey = { anthropic: null, openai: null };
  const connected = { anthropic: false, openai: false };

  async function postJson(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }

  async function refreshStatus() {
    try {
      const res = await postJson("/v1/setup/status", {});
      if (res.data) {
        if (res.data.anthropic && res.data.anthropic.configured) markConnected("anthropic", "(saved)");
        if (res.data.openai && res.data.openai.configured) markConnected("openai", "(saved)");
      }
    } catch {}
  }

  function markConnected(provider, label) {
    connected[provider] = true;
    $(provider + "-card").classList.add("connected");
    const badge = $(provider + "-badge");
    badge.textContent = "connected " + (label || "");
    badge.className = "badge connected";
    setStatus(provider + "-oauth-status", "ok", "✓ Connected");
  }

  async function validateKey(provider) {
    const inputId = provider + "-key";
    const statusId = provider + "-key-status";
    const btn = $(provider + "-validate");
    const key = $(inputId).value.trim();
    if (!key) { setStatus(statusId, "err", "Paste a key first."); return; }
    btn.disabled = true;
    setStatus(statusId, "info", "Testing...");
    const result = await postJson("/v1/setup/validate-" + provider + "-key", { apiKey: key });
    btn.disabled = false;
    if (result.data && result.data.ok) {
      validatedKey[provider] = key;
      setStatus(statusId, "ok", "✓ Looks good.");
    } else {
      validatedKey[provider] = null;
      const err = (result.data && (result.data.error || result.data.message)) || "Could not validate.";
      setStatus(statusId, "err", err);
    }
  }

  async function startOAuth(provider) {
    const statusId = provider + "-oauth-status";
    const btn = $(provider + "-signin");
    btn.disabled = true;
    setStatus(statusId, "info", "Starting sign-in...");
    const start = await postJson("/v1/setup/oauth/start", { provider });
    if (!start.data || !start.data.ok) {
      btn.disabled = false;
      const err = (start.data && start.data.error) || "Could not start sign-in.";
      setStatus(statusId, "err", err);
      return;
    }
    setStatus(statusId, "info", "Opening browser... if it didn't, ");
    // Browser may block window.open inside an async chain; the user-initiated
    // click satisfies most popup blockers because we re-trigger immediately.
    const popup = window.open(start.data.authUrl, "_blank", "noopener");
    if (!popup) {
      setStatus(statusId, "info", "");
      const el = $(statusId);
      el.className = "status info";
      el.innerHTML = "Open <a href=\\"" + start.data.authUrl + "\\" target=\\"_blank\\" rel=\\"noopener\\">this link</a> to sign in.";
    }
    // Poll for completion.
    const sessionId = start.data.sessionId;
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch("/v1/setup/oauth/poll?sessionId=" + encodeURIComponent(sessionId));
      const pdata = await poll.json().catch(() => null);
      if (!pdata) continue;
      if (pdata.status === "pending") {
        setStatus(statusId, "info", "Waiting for sign-in to complete...");
        continue;
      }
      if (pdata.status === "complete") {
        markConnected(provider, "(subscription)");
        return;
      }
      if (pdata.status === "error") {
        btn.disabled = false;
        setStatus(statusId, "err", pdata.error || "Sign-in failed.");
        return;
      }
    }
    btn.disabled = false;
    setStatus(statusId, "err", "Sign-in timed out. Try again.");
  }

  $("anthropic-signin").addEventListener("click", () => startOAuth("anthropic"));
  $("openai-signin").addEventListener("click", () => startOAuth("openai"));
  $("anthropic-validate").addEventListener("click", () => validateKey("anthropic"));
  $("openai-validate").addEventListener("click", () => validateKey("openai"));

  $("save").addEventListener("click", async () => {
    const errBanner = $("save-error");
    errBanner.classList.remove("show");

    const anthropicTyped = $("anthropic-key").value.trim();
    const openaiTyped = $("openai-key").value.trim();

    // If Anthropic is already connected (OAuth or pre-saved key), we're good.
    // Otherwise require a validated typed key.
    if (!connected.anthropic) {
      if (!anthropicTyped) {
        errBanner.textContent = "Sign in with Claude above, or paste an Anthropic API key.";
        errBanner.classList.add("show");
        return;
      }
      if (validatedKey.anthropic !== anthropicTyped) {
        await validateKey("anthropic");
        if (validatedKey.anthropic !== anthropicTyped) {
          errBanner.textContent = "Anthropic key didn't validate. Fix the error above and try again.";
          errBanner.classList.add("show");
          return;
        }
      }
    }
    if (!connected.openai && openaiTyped && validatedKey.openai !== openaiTyped) {
      await validateKey("openai");
      if (validatedKey.openai !== openaiTyped) {
        errBanner.textContent = "OpenAI key didn't validate. Clear the field if you want to skip it.";
        errBanner.classList.add("show");
        return;
      }
    }

    const payload = {};
    if (!connected.anthropic && anthropicTyped) payload.anthropicKey = anthropicTyped;
    if (!connected.openai && openaiTyped) payload.openaiKey = openaiTyped;

    if (Object.keys(payload).length > 0) {
      const saveBtn = $("save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      const result = await postJson("/v1/setup/save-keys", payload);
      if (!result.data || !result.data.ok) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Start Alien";
        errBanner.textContent = (result.data && result.data.error) || "Failed to save.";
        errBanner.classList.add("show");
        return;
      }
    }

    $("save").textContent = "✓ Done. Opening Alien...";
    // Fetch the gateway token from /v1/setup/status (loopback-only) so the
    // main UI doesn't bounce us to its token-paste screen.
    let gotoUrl = "/";
    try {
      const statusRes = await postJson("/v1/setup/status", {});
      if (statusRes.data && typeof statusRes.data.gatewayToken === "string") {
        gotoUrl = "/#token=" + encodeURIComponent(statusRes.data.gatewayToken);
      }
    } catch {}
    setTimeout(() => { window.location.href = gotoUrl; }, 600);
  });

  refreshStatus();
})();
</script>
</body>
</html>`;
}
