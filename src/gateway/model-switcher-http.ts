import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveConfigPath } from "../config/paths.js";
import { isClaudeCodeSessionAvailable } from "../security/claude-code-session.js";
import { readJsonBody } from "./hooks.js";
import { sendInvalidRequest, sendJson } from "./http-common.js";

/**
 * Model switcher — a tiny admin surface that lets the operator change
 * which model the default agent uses, without hand-editing alien.json.
 *
 *   GET  /v1/model               — current model + available choices
 *   POST /v1/model { provider, model } — persist + report
 *   GET  /model                  — standalone HTML page (UI)
 *
 * Loopback-only. POST writes to the alien.json config under
 * `agents.defaults.provider` + `agents.defaults.model`. Gateway
 * restart picks up the change.
 *
 * The choice set is curated to the providers Alien actually supports
 * end-to-end. Operators who want a model that's not in the list can
 * edit alien.json directly — this is the friendly path, not the only
 * path.
 */

const PATHS = new Set(["/v1/model", "/model"]);

type ChoiceKind = "anthropic" | "openai" | "google";

type ModelChoice = {
  readonly id: string;
  readonly provider: ChoiceKind;
  readonly model: string;
  readonly label: string;
  readonly tier: "fast" | "balanced" | "premium";
  readonly tagline: string;
};

const CHOICES: ReadonlyArray<ModelChoice> = [
  {
    id: "anthropic/claude-haiku-4-5",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    tier: "fast",
    tagline: "Cheapest + fastest Anthropic. Good for high-volume routine tasks.",
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    tier: "balanced",
    tagline: "The default. Best price/quality balance for most goals.",
  },
  {
    id: "anthropic/claude-opus-4-7",
    provider: "anthropic",
    model: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    tier: "premium",
    tagline: "Maximum reasoning depth. Use for complex multi-step goals.",
  },
  {
    id: "openai/gpt-5.5",
    provider: "openai",
    model: "gpt-5.5",
    label: "GPT-5.5",
    tier: "premium",
    tagline:
      "OpenAI flagship. Needs an OpenAI API key (subscription OAuth doesn't grant /v1/responses).",
  },
  // --- Gemini 3.x (current flagship family) ---
  {
    id: "google/gemini-3.1-pro",
    provider: "google",
    model: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    tier: "premium",
    tagline: "Latest Google flagship. Strongest reasoning + long context.",
  },
  {
    id: "google/gemini-3.1-flash",
    provider: "google",
    model: "gemini-3.1-flash",
    label: "Gemini 3.1 Flash",
    tier: "balanced",
    tagline: "Newest fast Gemini. Best price/quality for most workforce tasks.",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    provider: "google",
    model: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    tier: "fast",
    tagline: "Cheapest 3.x option. Generous free tier; ideal for high-volume routine work.",
  },
  {
    id: "google/gemini-3-pro",
    provider: "google",
    model: "gemini-3-pro",
    label: "Gemini 3 Pro",
    tier: "premium",
    tagline: "Prior-gen flagship. Slightly cheaper than 3.1 Pro with very similar quality.",
  },
  {
    id: "google/gemini-3-flash",
    provider: "google",
    model: "gemini-3-flash",
    label: "Gemini 3 Flash",
    tier: "balanced",
    tagline: "Prior-gen fast Gemini. Good fallback when 3.1 Flash is rate-limited.",
  },
  // --- Gemini 2.5 (still widely supported) ---
  {
    id: "google/gemini-2.5-pro",
    provider: "google",
    model: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    tier: "premium",
    tagline: "Established Google flagship. Mature multimodal + long context.",
  },
  {
    id: "google/gemini-2.5-flash",
    provider: "google",
    model: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    tier: "balanced",
    tagline: "Reliable fast Gemini. Wide free-tier limits.",
  },
  {
    id: "google/gemini-2.5-flash-lite",
    provider: "google",
    model: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    tier: "fast",
    tagline: "Cheapest 2.x Gemini. Use for high-volume routine work.",
  },
  // --- Legacy / fallback ---
  {
    id: "google/gemini-2.0-flash",
    provider: "google",
    model: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    tier: "fast",
    tagline: "Legacy 2.0 Flash. Kept around for compatibility with older callers.",
  },
  {
    id: "google/gemini-1.5-pro",
    provider: "google",
    model: "gemini-1.5-pro",
    label: "Gemini 1.5 Pro",
    tier: "balanced",
    tagline: "Legacy 1.5 Pro — large-context veteran. Still serviceable for document work.",
  },
];

export function isModelSwitcherPath(pathname: string): boolean {
  return PATHS.has(pathname);
}

export async function handleModelSwitcherRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isModelSwitcherPath(pathname)) return false;

  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { error: { type: "forbidden", message: "Loopback-only" } });
    return true;
  }

  if (pathname === "/model") {
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

  if (pathname === "/v1/model") {
    if (req.method === "GET") {
      const current = await readCurrentSelection();
      sendJson(res, 200, {
        current,
        choices: CHOICES,
        claudeCodeAvailable: isClaudeCodeSessionAvailable(),
      });
      return true;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, POST");
      res.end();
      return true;
    }
    const body = await readJsonBody(req, 1024);
    if (!body.ok) {
      sendInvalidRequest(res, body.error);
      return true;
    }
    const { provider, model } = (body.value as { provider?: unknown; model?: unknown }) ?? {};
    if (typeof provider !== "string" || typeof model !== "string") {
      sendInvalidRequest(res, "provider and model must be strings");
      return true;
    }
    const match = CHOICES.find((c) => c.provider === provider && c.model === model);
    if (!match) {
      sendInvalidRequest(res, `unsupported model: ${provider}/${model}`);
      return true;
    }
    try {
      await writeSelection(match.provider, match.model);
      sendJson(res, 200, {
        ok: true,
        selected: { provider: match.provider, model: match.model },
        message: "Saved to alien.json. Restart the gateway for the agent to pick up the change.",
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

/**
 * The config schema accepts agents.defaults.model as a "provider/model"
 * string (or a {primary, fallbacks, timeoutMs} object). We persist the
 * flat string form; `provider` is parsed from the prefix on read.
 */
async function readCurrentSelection(): Promise<{ provider: string; model: string } | null> {
  try {
    const raw = await fs.readFile(resolveConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as {
      agents?: { defaults?: { model?: unknown } };
    };
    const model = parsed.agents?.defaults?.model;
    if (typeof model === "string") {
      const slash = model.indexOf("/");
      if (slash > 0) {
        return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
      }
    }
  } catch {
    // file may not exist or be partial
  }
  return null;
}

async function writeSelection(provider: string, model: string): Promise<void> {
  const configPath = resolveConfigPath();
  let parsed: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configPath, "utf8");
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // file may not exist
  }
  const agents = (
    parsed.agents && typeof parsed.agents === "object" && parsed.agents !== null
      ? (parsed.agents as Record<string, unknown>)
      : {}
  ) as Record<string, unknown>;
  const defaults = (
    agents.defaults && typeof agents.defaults === "object" && agents.defaults !== null
      ? (agents.defaults as Record<string, unknown>)
      : {}
  ) as Record<string, unknown>;
  // Drop any stale top-level provider key from older versions of this
  // module — the schema doesn't allow it and leaving it tanks gateway boot.
  delete defaults.provider;
  defaults.model = `${provider}/${model}`;
  agents.defaults = defaults;
  parsed.agents = agents;
  await fs.writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(configPath, 0o600).catch(() => {});
}

function renderHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Model · Alien</title>
<style>${CSS}</style>
</head><body>
<div class="page">
  <p class="crumb"><a href="/">← Alien</a></p>
  <h1>👾 Which model runs the show?</h1>
  <p class="tag">Pick the model your agent uses by default. Saved to your local config — restart the gateway for it to take effect.</p>

  <div id="cc-banner" class="cc-banner" style="display:none">
    <b>Claude Code session detected.</b> Anthropic models route through your
    Pro/Max subscription billing automatically. Other choices need their own
    auth (Anthropic API key or OpenAI API key).
  </div>

  <div id="choices" class="choices"></div>
  <div id="status" class="status"></div>
</div>
${pageScript()}
</body></html>`;
}

const CSS = `
  :root {
    --bg: #faf8f4; --ink: #1a1714; --muted: #6b6258; --line: #e6dfd2;
    --gold: #b8923c; --gold-deep: #8e6e22; --ok: #2f7a4b; --err: #b53939;
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
  .cc-banner { background: #ffeed6; border: 1px solid #efd996; padding: 12px 14px;
    border-radius: 8px; font-size: 13px; color: #685320; margin: 0 0 18px; }
  .choices { display: flex; flex-direction: column; gap: 10px; }
  .choice { display: flex; gap: 14px; padding: 14px 18px; border: 1px solid var(--line);
    border-radius: 10px; background: #fff; cursor: pointer; align-items: center;
    text-align: left; font: inherit; color: var(--ink); width: 100%; }
  .choice:hover { border-color: var(--gold); }
  .choice.selected { border-color: var(--ok); background: #f6fbf7; }
  .choice .tier {
    width: 64px; flex-shrink: 0; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
    padding: 4px 10px; border-radius: 99px; background: #f4ecd9;
    text-align: center; align-self: flex-start;
  }
  .choice .tier.fast { background: #ddeede; color: var(--ok); }
  .choice .tier.balanced { background: #fbf3e2; color: var(--gold-deep); }
  .choice .tier.premium { background: #e8e0fb; color: #5a47a8; }
  .choice .body { flex: 1; }
  .choice .label { font-weight: 600; font-size: 15px; margin: 0 0 2px; }
  .choice .id { color: var(--muted); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .choice .tagline { color: var(--muted); font-size: 13px; margin: 4px 0 0; }
  .choice .check { width: 22px; font-size: 18px; color: var(--ok); text-align: right;
    flex-shrink: 0; }
  .status { margin-top: 18px; font-size: 14px; color: var(--muted); min-height: 22px; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }
`;

function pageScript(): string {
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
    let d = null;
    try { d = await r.json(); } catch {}
    return { status: r.status, data: d };
  }
  let current = null;

  function render(choices) {
    $("choices").innerHTML = choices.map((c) => {
      const isCurrent = current && current.provider === c.provider && current.model === c.model;
      return [
        '<button class="choice ' + (isCurrent ? 'selected' : '') + '" data-provider="' + esc(c.provider) + '" data-model="' + esc(c.model) + '">',
          '<span class="tier ' + esc(c.tier) + '">' + esc(c.tier) + '</span>',
          '<div class="body">',
            '<div class="label">' + esc(c.label) + '</div>',
            '<div class="id">' + esc(c.id) + '</div>',
            '<div class="tagline">' + esc(c.tagline) + '</div>',
          '</div>',
          '<div class="check">' + (isCurrent ? '✓' : '') + '</div>',
        '</button>',
      ].join('');
    }).join('');
    document.querySelectorAll('button.choice').forEach((b) => {
      b.addEventListener('click', async () => {
        const provider = b.getAttribute('data-provider');
        const model = b.getAttribute('data-model');
        $("status").className = "status";
        $("status").textContent = 'Saving…';
        const r = await fetchJson('/v1/model', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider, model }),
        });
        if (r.data && r.data.ok) {
          current = r.data.selected;
          $("status").className = "status ok";
          $("status").textContent = '✓ ' + (r.data.message || 'Saved. Restart the gateway to take effect.');
          render(choices);
        } else {
          $("status").className = "status err";
          $("status").textContent = (r.data && r.data.error) || 'Save failed.';
        }
      });
    });
  }

  (async () => {
    const r = await fetchJson('/v1/model', { method: 'GET' });
    if (!r.data) {
      $("status").className = "status err";
      $("status").textContent = 'Failed to load.';
      return;
    }
    current = r.data.current;
    if (r.data.claudeCodeAvailable) {
      $("cc-banner").style.display = "block";
    }
    render(r.data.choices);
  })();
})();
</script>`;
}
