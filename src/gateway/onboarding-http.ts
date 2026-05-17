import { promises as fsp } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { resolveAnthropicOAuthPath } from "../security/anthropic-oauth-store.js";
import { resolveGeminiOAuthPath } from "../security/gemini-oauth-store.js";
import { resolveOpenAIOAuthPath } from "../security/openai-oauth-store.js";
import { sendJson } from "./http-common.js";

/**
 * /onboarding — the UI-driven first-run experience.
 *
 * Five focused single-purpose pages, navigated step-by-step. Each one
 * has progress dots, inline help, and a single primary action.
 * Operator never needs the terminal.
 *
 *   /onboarding              — Welcome + "Get started"
 *   /onboarding/brain        — Pick a provider (Anthropic / OpenAI / Gemini)
 *   /onboarding/sign-in      — Provider-specific auth (OAuth or paste key)
 *   /onboarding/soul         — Name + role + purpose for your Alien
 *   /onboarding/done         — "You're ready. Launch your first mission."
 *
 *   GET /v1/onboarding/state — JSON: which steps are complete (used for
 *                              first-run detection from /dashboard)
 *
 * State is derived from on-disk artifacts (OAuth files / keychain /
 * SOUL.md) — no separate "onboarding cursor" file. That way the user
 * can re-enter mid-flow and we know where to drop them.
 *
 * Loopback-only. Reuses existing /v1/setup/* and /v1/soul backends so
 * we never duplicate persistence logic.
 */

const PATHS = new Set([
  "/onboarding",
  "/onboarding/brain",
  "/onboarding/sign-in",
  "/onboarding/soul",
  "/onboarding/done",
  "/v1/onboarding/state",
]);

export function isOnboardingPath(pathname: string): boolean {
  return PATHS.has(pathname);
}

export async function handleOnboardingRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isOnboardingPath(pathname)) return false;
  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { error: { type: "forbidden", message: "Loopback-only" } });
    return true;
  }

  if (pathname === "/v1/onboarding/state") {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    sendJson(res, 200, await readOnboardingState());
    return true;
  }

  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  let html: string;
  switch (pathname) {
    case "/onboarding":
      html = renderWelcome();
      break;
    case "/onboarding/brain":
      html = renderBrain();
      break;
    case "/onboarding/sign-in":
      html = renderSignIn(url.searchParams.get("provider") ?? "");
      break;
    case "/onboarding/soul":
      html = renderSoul();
      break;
    case "/onboarding/done":
      html = renderDone();
      break;
    default:
      html = renderWelcome();
  }
  res.end(html);
  return true;
}

// ---- state ----

type OnboardingState = {
  readonly brainConnected: boolean;
  readonly anthropic: boolean;
  readonly openai: boolean;
  readonly gemini: boolean;
  readonly soulConfigured: boolean;
  readonly nextStep: "welcome" | "brain" | "soul" | "done";
};

async function readOnboardingState(): Promise<OnboardingState> {
  const stateDir = resolveStateDir(process.env);
  const [anthropic, openai, gemini, soulConfigured] = await Promise.all([
    fileExists(resolveAnthropicOAuthPath()).then(
      (oauth) => oauth || envOrKeychain("ANTHROPIC_API_KEY", "anthropic-api-key"),
    ),
    fileExists(resolveOpenAIOAuthPath()).then(
      (oauth) => oauth || envOrKeychain("OPENAI_API_KEY", "openai-api-key"),
    ),
    fileExists(resolveGeminiOAuthPath()).then(
      (oauth) =>
        oauth ||
        envOrKeychain("GEMINI_API_KEY", "gemini-api-key") ||
        envOrKeychain("GOOGLE_API_KEY", "gemini-api-key"),
    ),
    readWorkspaceSoulConfigured(stateDir),
  ]);
  const brainConnected = anthropic || openai || gemini;
  const nextStep: OnboardingState["nextStep"] = !brainConnected
    ? "brain"
    : !soulConfigured
      ? "soul"
      : "done";
  return { brainConnected, anthropic, openai, gemini, soulConfigured, nextStep };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function envOrKeychain(envName: string, _keyName: string): boolean {
  // Cheap check — only env. Full keychain check happens in /integrations
  // which has the heavier helper. For the wizard's "do you have any auth"
  // gate, env-only is plenty accurate.
  return Boolean(process.env[envName]);
}

async function readWorkspaceSoulConfigured(stateDir: string): Promise<boolean> {
  try {
    const raw = await fsp.readFile(path.join(stateDir, "alien.json"), "utf8");
    const cfg = JSON.parse(raw) as { agents?: { defaults?: { workspace?: string } } };
    const workspace = cfg.agents?.defaults?.workspace;
    if (!workspace) return false;
    return fileExists(path.join(workspace, "SOUL.md"));
  } catch {
    return false;
  }
}

// ---- helpers ----

function methodNotAllowed(res: ServerResponse, allow: string): true {
  res.statusCode = 405;
  res.setHeader("Allow", allow);
  res.end();
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

// ---- shared CSS + chrome ----

const SHARED_CSS = `
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
    --ok: #2b8a3e;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 20px -8px rgba(0,0,0,0.10);
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 -apple-system, "SF Pro Text", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
    display: flex; flex-direction: column;
  }
  a { color: inherit; text-decoration: none; }
  button { font-family: inherit; }

  .topbar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 24px 32px; max-width: 720px; width: 100%;
    margin: 0 auto;
  }
  .brand { display: flex; align-items: center; gap: 10px;
    font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
  .brand .glyph { font-size: 22px; }
  .skip {
    color: var(--ink-mute); font-size: 13px;
    padding: 6px 12px; border-radius: 999px;
    transition: color 0.15s, background 0.15s;
  }
  .skip:hover { color: var(--ink); background: var(--surface); }

  /* Progress dots */
  .progress {
    display: flex; gap: 8px; justify-content: center;
    margin: 8px 0 48px;
  }
  .progress .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--line); transition: background 0.15s, width 0.15s;
  }
  .progress .dot.done { background: var(--ok); }
  .progress .dot.active { background: var(--ink); width: 24px; border-radius: 4px; }

  main.step {
    flex: 1;
    max-width: 560px; width: 100%;
    margin: 0 auto;
    padding: 16px 32px 80px;
  }
  .step h1 {
    font-size: 36px; font-weight: 600; letter-spacing: -0.02em;
    color: var(--ink); margin: 0 0 12px; line-height: 1.15;
  }
  .step .lead {
    font-size: 17px; line-height: 1.5; color: var(--ink-soft);
    margin: 0 0 32px;
  }

  /* Provider cards (brain step) */
  .options { display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px; }
  .option {
    display: block; width: 100%; text-align: left;
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius-md); padding: 18px 20px;
    cursor: pointer; font-family: inherit;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.05s;
  }
  .option:hover { border-color: var(--line-strong); box-shadow: var(--shadow-sm); }
  .option:active { transform: translateY(1px); }
  .option.selected { border-color: var(--ink); box-shadow: var(--shadow-md); }
  .option-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .option-icon { font-size: 20px; }
  .option-name { font-size: 16px; font-weight: 600; color: var(--ink); }
  .option-tag {
    margin-left: auto; font-size: 11px; font-weight: 600;
    padding: 2px 9px; border-radius: 999px;
    background: #ebf6ec; color: var(--ok);
  }
  .option-tag.beta { background: #fbf2d4; color: var(--accent); }
  .option-desc { color: var(--ink-soft); font-size: 13px; line-height: 1.5; }

  /* Inputs */
  .field { margin-bottom: 20px; }
  .field label {
    display: block; font-size: 13px; font-weight: 600;
    color: var(--ink); margin-bottom: 6px;
  }
  .field .help {
    font-size: 12px; color: var(--ink-mute);
    margin-top: 6px; line-height: 1.5;
  }
  .field input, .field textarea {
    width: 100%;
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: 10px 14px;
    color: var(--ink); font: inherit; font-size: 15px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .field input:focus, .field textarea:focus {
    outline: none; border-color: var(--ink); box-shadow: var(--shadow-sm);
  }
  .field textarea { min-height: 80px; resize: vertical; line-height: 1.5; }

  /* Buttons */
  .actions {
    display: flex; justify-content: space-between; align-items: center;
    gap: 12px; margin-top: 32px;
  }
  .btn-primary {
    background: var(--ink); color: #fff; border: none;
    padding: 12px 24px; border-radius: var(--radius-sm);
    font-size: 15px; font-weight: 600; cursor: pointer;
    transition: background 0.15s, transform 0.05s;
  }
  .btn-primary:hover { background: #000; }
  .btn-primary:active { transform: translateY(1px); }
  .btn-primary:disabled { background: var(--ink-mute); cursor: not-allowed; }
  .btn-ghost {
    background: transparent; color: var(--ink-mute); border: none;
    padding: 12px 16px; font-size: 14px; cursor: pointer;
    transition: color 0.15s;
  }
  .btn-ghost:hover { color: var(--ink); }

  .feedback { font-size: 13px; min-height: 18px; margin-top: 8px; }
  .feedback.ok { color: var(--ok); }
  .feedback.err { color: #b8423a; }

  .pair-card {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius-md); padding: 20px;
    margin-bottom: 16px;
  }
  .pair-card .title { font-weight: 600; margin-bottom: 6px; }
  .pair-card .desc { color: var(--ink-soft); font-size: 13px; line-height: 1.5; margin-bottom: 14px; }
`;

function renderShell(step: 1 | 2 | 3 | 4, title: string, body: string): string {
  const dots = [1, 2, 3, 4]
    .map((n) => {
      const cls = n === step ? "dot active" : n < step ? "dot done" : "dot";
      return `<span class="${cls}"></span>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>${SHARED_CSS}</style>
</head>
<body>
<div class="topbar">
  <a class="brand" href="/onboarding"><span class="glyph">👾</span> Alien</a>
  <a class="skip" href="/dashboard">Skip for now</a>
</div>
<div class="progress">${dots}</div>
<main class="step">
${body}
</main>
</body>
</html>`;
}

// ---- step 1: welcome ----

function renderWelcome(): string {
  const body = `
<h1>Meet your AI workforce.</h1>
<p class="lead">
  Alien is a team of 84 AI experts that work on missions together.
  Tell them what to build and they do it — research, write, code, ship.
</p>
<p class="lead">
  Setup takes about 90 seconds: pick a brain, sign in, name your team.
</p>
<div class="actions">
  <span></span>
  <a class="btn-primary" href="/onboarding/brain">Get started →</a>
</div>
`;
  return renderShell(1, "👾 Welcome to Alien", body);
}

// ---- step 2: pick brain ----

function renderBrain(): string {
  const body = `
<h1>Pick a brain.</h1>
<p class="lead">
  Every expert needs a model to think with. Pick the provider you'd like to use —
  you can change this any time and mix providers per task later.
</p>
<div class="options">
  <button class="option" data-provider="gemini">
    <div class="option-head">
      <span class="option-icon">✨</span>
      <span class="option-name">Google Gemini</span>
      <span class="option-tag">Free</span>
    </div>
    <div class="option-desc">
      Sign in with your Google account. Free Code Assist tier covers daily use,
      no credit card needed. Best starting point.
    </div>
  </button>
  <button class="option" data-provider="anthropic">
    <div class="option-head">
      <span class="option-icon">🟣</span>
      <span class="option-name">Anthropic Claude</span>
      <span class="option-tag beta">Paid</span>
    </div>
    <div class="option-desc">
      Sign in with your Pro/Max subscription, or paste an API key.
      Best for nuanced reasoning and long contexts.
    </div>
  </button>
  <button class="option" data-provider="openai">
    <div class="option-head">
      <span class="option-icon">🟢</span>
      <span class="option-name">OpenAI GPT</span>
      <span class="option-tag beta">Paid</span>
    </div>
    <div class="option-desc">
      Paste an API key from platform.openai.com.
      Pay-per-token billing.
    </div>
  </button>
</div>
<div class="actions">
  <a class="btn-ghost" href="/onboarding">← Back</a>
  <span></span>
</div>
<script>
document.querySelectorAll('.option').forEach((b) => {
  b.addEventListener('click', () => {
    const p = b.getAttribute('data-provider');
    window.location.href = '/onboarding/sign-in?provider=' + encodeURIComponent(p);
  });
});
</script>
`;
  return renderShell(2, "👾 Alien · Pick a brain", body);
}

// ---- step 3: sign-in (provider-specific) ----

function renderSignIn(provider: string): string {
  const meta: Record<
    string,
    {
      name: string;
      icon: string;
      keyUrl: string;
      keyPlaceholder: string;
      oauth: boolean;
      oauthLabel: string;
      oauthHelp: string;
    }
  > = {
    gemini: {
      name: "Google Gemini",
      icon: "✨",
      keyUrl: "https://aistudio.google.com/apikey",
      keyPlaceholder: "AIza…",
      oauth: true,
      oauthLabel: "Sign in with Google",
      oauthHelp:
        "Opens Google in a new tab. After you sign in, Alien gets free Code Assist access via your Google account. No credit card needed.",
    },
    anthropic: {
      name: "Anthropic Claude",
      icon: "🟣",
      keyUrl: "https://console.anthropic.com/settings/keys",
      keyPlaceholder: "sk-ant-…",
      oauth: true,
      oauthLabel: "Sign in with Claude (Pro/Max)",
      oauthHelp:
        "Opens claude.ai in a new tab. After you sign in, inference bills against your Pro/Max plan's extra-usage pool.",
    },
    openai: {
      name: "OpenAI GPT",
      icon: "🟢",
      keyUrl: "https://platform.openai.com/api-keys",
      keyPlaceholder: "sk-…",
      oauth: false,
      oauthLabel: "",
      oauthHelp: "",
    },
  };
  const m = meta[provider] ?? meta["gemini"]!;
  const oauthCard = m.oauth
    ? `
<div class="pair-card">
  <div class="title">${m.oauthLabel}</div>
  <div class="desc">${m.oauthHelp}</div>
  <button class="btn-primary" id="oauth-btn">${m.oauthLabel}</button>
  <div class="feedback" id="oauth-feedback"></div>
</div>
<div style="text-align:center; color: var(--ink-mute); font-size:13px; margin: 16px 0;">— or —</div>
`
    : "";
  const body = `
<h1><span style="font-size:32px">${m.icon}</span> Connect ${m.name}.</h1>
<p class="lead">
  Pick how you want to sign in. Either path works — sign-in is friendlier;
  API keys give you full control.
</p>
${oauthCard}
<div class="pair-card">
  <div class="title">Paste an API key</div>
  <div class="desc">
    Get one at <a href="${m.keyUrl}" target="_blank" rel="noopener" style="color:var(--accent)">${m.keyUrl}</a>.
    We store it in your OS keychain.
  </div>
  <div class="field">
    <label for="key-input">API key</label>
    <input id="key-input" type="password" placeholder="${m.keyPlaceholder}" autocomplete="off" />
    <div class="help">Stored locally on your machine. Never sent anywhere except the provider.</div>
  </div>
  <div style="display:flex; gap:10px;">
    <button class="btn-primary" id="save-btn">Save key</button>
  </div>
  <div class="feedback" id="key-feedback"></div>
</div>

<div class="actions">
  <a class="btn-ghost" href="/onboarding/brain">← Back</a>
  <a class="btn-primary" id="continue" style="display:none" href="/onboarding/soul">Continue →</a>
</div>

<script>
const PROVIDER = ${JSON.stringify(provider)};
const $ = (id) => document.getElementById(id);

async function startOAuth() {
  const btn = $("oauth-btn");
  btn.disabled = true;
  $("oauth-feedback").className = "feedback";
  $("oauth-feedback").textContent = "Starting sign-in…";
  try {
    const r = await fetch("/v1/setup/oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: PROVIDER }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error((d && d.error) || "Could not start sign-in");
    if (d.authUrl) {
      window.open(d.authUrl, "_blank", "noopener");
      $("oauth-feedback").textContent = "Sign in finished in the new tab? Waiting for confirmation…";
    }
    // Poll for completion
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const p = await fetch("/v1/setup/oauth/poll?sessionId=" + encodeURIComponent(d.sessionId));
      const pd = await p.json();
      if (pd.status === "complete") {
        $("oauth-feedback").className = "feedback ok";
        $("oauth-feedback").textContent = "✓ Connected. Click Continue to set up your team.";
        $("continue").style.display = "";
        return;
      }
      if (pd.status === "error") throw new Error(pd.error || "Sign-in failed");
    }
    throw new Error("Sign-in timed out after 5 minutes");
  } catch (err) {
    $("oauth-feedback").className = "feedback err";
    $("oauth-feedback").textContent = "Failed: " + (err && err.message || err);
  } finally {
    btn.disabled = false;
  }
}

async function saveKey() {
  const input = $("key-input");
  const key = (input.value || "").trim();
  if (!key) {
    $("key-feedback").className = "feedback err";
    $("key-feedback").textContent = "Paste a key first.";
    return;
  }
  $("key-feedback").className = "feedback";
  $("key-feedback").textContent = "Testing…";
  $("save-btn").disabled = true;
  try {
    const v = await fetch("/v1/setup/validate-" + PROVIDER + "-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    const vd = await v.json();
    if (!vd.ok) throw new Error((vd && vd.error) || "Key rejected");
    const payload = PROVIDER === "anthropic" ? { anthropicKey: key }
      : PROVIDER === "openai" ? { openaiKey: key }
      : { geminiKey: key };
    const s = await fetch("/v1/setup/save-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const sd = await s.json();
    if (!sd.ok) throw new Error((sd && sd.error) || "Save failed");
    input.value = "";
    $("key-feedback").className = "feedback ok";
    $("key-feedback").textContent = "✓ Saved. Click Continue to set up your team.";
    $("continue").style.display = "";
  } catch (err) {
    $("key-feedback").className = "feedback err";
    $("key-feedback").textContent = "Failed: " + (err && err.message || err);
  } finally {
    $("save-btn").disabled = false;
  }
}

if ($("oauth-btn")) $("oauth-btn").addEventListener("click", startOAuth);
$("save-btn").addEventListener("click", saveKey);
</script>
`;
  return renderShell(3, `👾 Alien · Connect ${m.name}`, body);
}

// ---- step 4: soul ----

function renderSoul(): string {
  const body = `
<h1>Name your team.</h1>
<p class="lead">
  Your Alien has a soul — a name, a role, and what it's here to do.
  Every expert reads this before they start work. You can change it later.
</p>
<div class="field">
  <label for="name">Name</label>
  <input id="name" type="text" placeholder="Alien" />
  <div class="help">How your team refers to itself. "Alien" is fine. So is "Halcyon" or "Arroyo".</div>
</div>
<div class="field">
  <label for="role">Role</label>
  <input id="role" type="text" placeholder="your AI workforce" />
  <div class="help">One-line description of what your team is. Examples: "your AI workforce", "your strategy partner", "your launch crew".</div>
</div>
<div class="field">
  <label for="purpose">Purpose</label>
  <textarea id="purpose" placeholder="Help me build and run my startup."></textarea>
  <div class="help">What's the team here to do? Two or three sentences. The more specific, the better the planning.</div>
</div>
<div class="actions">
  <a class="btn-ghost" href="/onboarding/sign-in">← Back</a>
  <button class="btn-primary" id="save">Save & continue →</button>
</div>
<div class="feedback" id="feedback"></div>

<script>
const $ = (id) => document.getElementById(id);
async function load() {
  try {
    const r = await fetch("/v1/soul");
    const d = await r.json();
    if (d) {
      $("name").value = d.name || "";
      $("role").value = d.role || "";
      $("purpose").value = d.purpose || "";
    }
  } catch {}
}
async function save() {
  const name = ($("name").value || "").trim() || "Alien";
  const role = ($("role").value || "").trim() || "your AI workforce";
  const purpose = ($("purpose").value || "").trim() || "Help me build and run my work.";
  $("feedback").className = "feedback";
  $("feedback").textContent = "Saving…";
  $("save").disabled = true;
  try {
    const r = await fetch("/v1/soul", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, purpose }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error((d && d.error) || "Save failed");
    window.location.href = "/onboarding/done";
  } catch (err) {
    $("feedback").className = "feedback err";
    $("feedback").textContent = "Failed: " + (err && err.message || err);
    $("save").disabled = false;
  }
}
$("save").addEventListener("click", save);
load();
</script>
`;
  return renderShell(4, "👾 Alien · Name your team", body);
}

// ---- step 5 (still tracked as step 4 visually): done ----

function renderDone(): string {
  const body = `
<h1>You're ready.</h1>
<p class="lead">
  Your team is set up. Hit the button below to drop into the dashboard and
  give them their first mission.
</p>
<div class="pair-card">
  <div class="title">What now?</div>
  <div class="desc" style="margin:0;">
    On the dashboard, type a goal in the "New mission" box.
    Examples: "Ship a landing page for the new pricing tier" or
    "Research the top 5 competitors in our space."
    Hit Launch — the team picks it up automatically.
  </div>
</div>
<div class="actions">
  <span></span>
  <a class="btn-primary" href="/dashboard">Open dashboard →</a>
</div>
`;
  return renderShell(4, "👾 Alien · You're ready", body);
}
