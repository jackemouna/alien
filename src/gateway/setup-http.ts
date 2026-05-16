import type { IncomingMessage, ServerResponse } from "node:http";
import { detectKeychainBackend, setKeychainSecret } from "../security/os-keychain.js";
import { readSecretFromEnvOrKeychain } from "../security/secret-source.js";
import { readJsonBodyOrError, sendInvalidRequest, sendJson, sendText } from "./http-common.js";

/**
 * First-run setup wizard, served as a standalone HTML page. The page is
 * deliberately not part of the main Lit SPA bundle — it must work before
 * any gateway token is configured, before the main UI is reachable, and
 * before the user has done anything except open the browser.
 *
 *   GET  /setup                           — the wizard HTML
 *   POST /v1/setup/status                 — what's missing? (no body)
 *   POST /v1/setup/validate-anthropic     — test an Anthropic key live
 *   POST /v1/setup/validate-openai        — test an OpenAI key live
 *   POST /v1/setup/save                   — persist validated keys to the
 *                                           OS keychain + the current
 *                                           process env so they take
 *                                           effect without a restart
 *
 * Auth: the wizard endpoints are loopback-only and never require a bearer
 * token, because the user is configuring the gateway *before* a token
 * exists. Requests from any non-loopback IP are rejected. For non-MVP
 * hardening, gate these behind a "wizard is open" flag that flips off
 * once the first save succeeds.
 */

const ANTHROPIC_KEYCHAIN = { service: "alien.ai", account: "anthropic-api-key" } as const;
const OPENAI_KEYCHAIN = { service: "alien.ai", account: "openai-api-key" } as const;

const SETUP_PATHS = new Set([
  "/setup",
  "/v1/setup/status",
  "/v1/setup/validate-anthropic",
  "/v1/setup/validate-openai",
  "/v1/setup/save",
]);

export function isSetupPath(pathname: string): boolean {
  return SETUP_PATHS.has(pathname);
}

export async function handleSetupRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isSetupPath(pathname)) return false;

  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, {
      error: {
        type: "forbidden",
        message: "Setup is only reachable from localhost",
      },
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

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return true;
  }

  if (pathname === "/v1/setup/status") {
    sendJson(res, 200, readSetupStatus());
    return true;
  }

  const body = (await readJsonBodyOrError(req, res, 4096)) as
    | { readonly apiKey?: unknown; readonly anthropicKey?: unknown; readonly openaiKey?: unknown }
    | undefined;
  if (body === undefined) return true;

  if (pathname === "/v1/setup/validate-anthropic") {
    const key = readKey(body.apiKey ?? body.anthropicKey);
    if (!key) {
      sendInvalidRequest(res, "Missing apiKey");
      return true;
    }
    const result = await validateAnthropicKey(key);
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (pathname === "/v1/setup/validate-openai") {
    const key = readKey(body.apiKey ?? body.openaiKey);
    if (!key) {
      sendInvalidRequest(res, "Missing apiKey");
      return true;
    }
    const result = await validateOpenAiKey(key);
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (pathname === "/v1/setup/save") {
    const anthropic = readKey(body.anthropicKey);
    const openai = readKey(body.openaiKey);
    if (!anthropic && !openai) {
      sendInvalidRequest(res, "Provide at least anthropicKey or openaiKey");
      return true;
    }
    const result = saveKeys({ anthropic, openai });
    sendJson(res, result.ok ? 200 : 500, result);
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

function readKey(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

type ValidationResult =
  | { readonly ok: true; readonly model?: string; readonly accountHint?: string }
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
    if (res.ok) {
      return { ok: true, model: "claude-haiku-4-5" };
    }
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
    if (res.ok) {
      return { ok: true };
    }
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
  const snippet = body.slice(0, 200);
  return `${provider} returned HTTP ${status}: ${snippet}`;
}

type SaveResult =
  | { readonly ok: true; readonly savedTo: "keychain" | "env-only"; readonly providers: string[] }
  | { readonly ok: false; readonly error: string };

function saveKeys(keys: { anthropic?: string; openai?: string }): SaveResult {
  const providers: string[] = [];
  const backend = detectKeychainBackend();
  const useKeychain = backend.available;
  try {
    if (keys.anthropic) {
      if (useKeychain) {
        setKeychainSecret(ANTHROPIC_KEYCHAIN, keys.anthropic);
      }
      process.env.ANTHROPIC_API_KEY = keys.anthropic;
      providers.push("anthropic");
    }
    if (keys.openai) {
      if (useKeychain) {
        setKeychainSecret(OPENAI_KEYCHAIN, keys.openai);
      }
      process.env.OPENAI_API_KEY = keys.openai;
      providers.push("openai");
    }
    return {
      ok: true,
      savedTo: useKeychain ? "keychain" : "env-only",
      providers,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type SetupStatus = {
  readonly anthropic: boolean;
  readonly openai: boolean;
  readonly keychainAvailable: boolean;
  readonly keychainBackend: string;
};

function readSetupStatus(): SetupStatus {
  const backend = detectKeychainBackend();
  return {
    anthropic: Boolean(
      readSecretFromEnvOrKeychain({
        envVarName: "ANTHROPIC_API_KEY",
        keychain: ANTHROPIC_KEYCHAIN,
        keychainGate: "always",
      }),
    ),
    openai: Boolean(
      readSecretFromEnvOrKeychain({
        envVarName: "OPENAI_API_KEY",
        keychain: OPENAI_KEYCHAIN,
        keychainGate: "always",
      }),
    ),
    keychainAvailable: backend.available,
    keychainBackend: backend.available ? backend.backend : "unavailable",
  };
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

function renderSetupHtml(): string {
  // Self-contained — no Lit, no external assets. Premium ivory/black/gold
  // theme to match the rest of the UI.
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
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 32px 20px;
  }
  .card {
    max-width: 560px; width: 100%; background: #fff; border: 1px solid var(--line);
    border-radius: 16px; padding: 36px 36px 32px; box-shadow: 0 4px 22px rgba(0,0,0,.04);
  }
  .brand { font-size: 28px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 4px; }
  .tag { color: var(--muted); margin: 0 0 24px; font-size: 15px; }
  h2 { font-size: 17px; margin: 24px 0 6px; font-weight: 600; }
  label { display: block; font-size: 13px; color: var(--muted); margin: 0 0 4px; font-weight: 500; }
  .field { display: flex; gap: 6px; margin: 0 0 6px; }
  input[type="password"], input[type="text"] {
    flex: 1; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--field); font: inherit; color: var(--ink);
  }
  input:focus { outline: 2px solid var(--gold); outline-offset: -1px; border-color: var(--gold); }
  button {
    padding: 10px 16px; border: 1px solid var(--line); border-radius: 8px;
    background: #fff; font: inherit; font-weight: 500; cursor: pointer; color: var(--ink);
  }
  button:hover { border-color: var(--gold); }
  button.primary {
    background: var(--ink); color: #fff; border-color: var(--ink);
    padding: 12px 22px; font-weight: 500; margin-top: 16px; width: 100%;
  }
  button.primary:hover { background: var(--gold-deep); border-color: var(--gold-deep); }
  button:disabled { opacity: .5; cursor: default; }
  .help { font-size: 13px; color: var(--muted); margin: 4px 0 0; }
  .help a { color: var(--gold-deep); text-decoration: underline; }
  .status { font-size: 13px; margin: 6px 0 0; min-height: 18px; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }
  .footer { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line);
    font-size: 12px; color: var(--muted); }
  .row { display: flex; gap: 8px; align-items: center; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 99px;
    background: #f4ecd9; color: var(--gold-deep); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em; }
  .err-banner { background: #fdecec; border: 1px solid #f4caca; color: var(--err);
    padding: 10px 12px; border-radius: 8px; margin: 12px 0 0; font-size: 14px; display: none; }
  .err-banner.show { display: block; }
</style>
</head>
<body>
  <div class="card">
    <h1 class="brand">👾 Welcome to Alien</h1>
    <p class="tag">Anyone can hire their own AI team. Takes 60 seconds.</p>

    <h2>1. Connect Anthropic <span class="pill">required</span></h2>
    <p class="help">Your Anthropic key powers Alien's thinking. Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
    <div class="field">
      <input id="anthropic-key" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
      <button id="anthropic-validate" type="button">Test</button>
    </div>
    <div id="anthropic-status" class="status"></div>

    <h2>2. Connect OpenAI <span class="pill" style="background:#f0ece4;color:var(--muted)">optional</span></h2>
    <p class="help">Optional. Some skills work better with GPT. OpenAI doesn't offer OAuth for API access, so paste the key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>.</p>
    <div class="field">
      <input id="openai-key" type="password" placeholder="sk-..." autocomplete="off" spellcheck="false">
      <button id="openai-validate" type="button">Test</button>
    </div>
    <div id="openai-status" class="status"></div>

    <button id="save" class="primary" type="button">Save and start Alien</button>
    <div id="save-error" class="err-banner"></div>

    <div class="footer">
      Keys are stored in your OS keychain (macOS Keychain or libsecret on Linux). They never leave your machine.
    </div>
  </div>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const setStatus = (id, ok, msg) => {
    const el = $(id);
    el.className = "status " + (ok ? "ok" : msg ? "err" : "");
    el.textContent = msg || "";
  };
  const validated = { anthropic: null, openai: null };

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

  async function testKey(provider) {
    const inputId = provider + "-key";
    const statusId = provider + "-status";
    const btn = $(provider + "-validate");
    const key = $(inputId).value.trim();
    if (!key) {
      setStatus(statusId, false, "Paste a key first.");
      return;
    }
    btn.disabled = true;
    setStatus(statusId, true, "Testing...");
    const result = await postJson("/v1/setup/validate-" + provider, { apiKey: key });
    btn.disabled = false;
    if (result.data && result.data.ok) {
      validated[provider] = key;
      setStatus(statusId, true, "✓ Looks good.");
    } else {
      validated[provider] = null;
      const err = (result.data && (result.data.error || result.data.message)) || "Could not validate.";
      setStatus(statusId, false, err);
    }
  }

  $("anthropic-validate").addEventListener("click", () => testKey("anthropic"));
  $("openai-validate").addEventListener("click", () => testKey("openai"));

  $("save").addEventListener("click", async () => {
    const errBanner = $("save-error");
    errBanner.classList.remove("show");

    const anthropicTyped = $("anthropic-key").value.trim();
    const openaiTyped = $("openai-key").value.trim();

    if (!anthropicTyped) {
      errBanner.textContent = "Anthropic key is required.";
      errBanner.classList.add("show");
      return;
    }

    // Auto-validate any typed-but-untested key.
    if (validated.anthropic !== anthropicTyped) {
      await testKey("anthropic");
      if (validated.anthropic !== anthropicTyped) {
        errBanner.textContent = "Anthropic key didn't validate. Fix the error above and try again.";
        errBanner.classList.add("show");
        return;
      }
    }
    if (openaiTyped && validated.openai !== openaiTyped) {
      await testKey("openai");
      if (validated.openai !== openaiTyped) {
        errBanner.textContent = "OpenAI key didn't validate. Clear the field if you want to skip it.";
        errBanner.classList.add("show");
        return;
      }
    }

    const saveBtn = $("save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    const payload = { anthropicKey: anthropicTyped };
    if (openaiTyped) payload.openaiKey = openaiTyped;
    const result = await postJson("/v1/setup/save", payload);
    if (result.data && result.data.ok) {
      saveBtn.textContent = "✓ Done. Opening Alien...";
      setTimeout(() => { window.location.href = "/"; }, 600);
    } else {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save and start Alien";
      errBanner.textContent = (result.data && result.data.error) || "Failed to save.";
      errBanner.classList.add("show");
    }
  });
})();
</script>
</body>
</html>`;
}
