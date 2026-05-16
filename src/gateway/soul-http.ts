import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { readJsonBody } from "./hooks.js";
import { sendInvalidRequest, sendJson } from "./http-common.js";

/**
 * Soul Setup — the page where the operator tells the agent who it is,
 * what its purpose is, and who they (the operator) are. The agent reads
 * three workspace files on every turn:
 *
 *   - SOUL.md      — agent's identity + how it operates
 *   - IDENTITY.md  — name, vibe, role, emoji
 *   - USER.md      — operator profile
 *
 * Default content (inherited from upstream) introduces the agent as
 * "C-3PO — Clawd's Third Protocol Observer," which is the wrong tone
 * for Alien. This page makes those files editable from a form.
 *
 * Loopback-only. Writes to the workspace dir resolved from alien.json's
 * agents.defaults.workspace.
 *
 *   GET  /soul       — HTML page
 *   GET  /v1/soul    — current fields { name, role, purpose, tone, userName, userAbout }
 *   POST /v1/soul    — persist
 */

const PATHS = new Set(["/soul", "/v1/soul"]);

type SoulFields = {
  name: string;
  role: string;
  purpose: string;
  tone: string;
  userName: string;
  userAbout: string;
};

const DEFAULTS: SoulFields = {
  name: "Alien",
  role: "Personal AI workforce",
  purpose:
    "Help me turn one prompt into a fully-working result. Plan in small batches, check the work, and tell me when you need something I haven't given you.",
  tone: "Calm, capable, slightly otherworldly. Honest about what you don't know. Action-oriented — try and learn rather than discuss endlessly. Never send irreversible messages on my behalf without asking first.",
  userName: "",
  userAbout: "",
};

export function isSoulPath(pathname: string): boolean {
  return PATHS.has(pathname);
}

export async function handleSoulRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isSoulPath(pathname)) return false;
  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { error: { type: "forbidden", message: "Loopback-only" } });
    return true;
  }

  if (pathname === "/soul") {
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

  if (pathname === "/v1/soul") {
    if (req.method === "GET") {
      sendJson(res, 200, await readSoulFields());
      return true;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, POST");
      res.end();
      return true;
    }
    const body = await readJsonBody(req, 16 * 1024);
    if (!body.ok) {
      sendInvalidRequest(res, body.error);
      return true;
    }
    try {
      const incoming = body.value as Partial<SoulFields>;
      const fields: SoulFields = {
        name: readStr(incoming.name) ?? DEFAULTS.name,
        role: readStr(incoming.role) ?? DEFAULTS.role,
        purpose: readStr(incoming.purpose) ?? DEFAULTS.purpose,
        tone: readStr(incoming.tone) ?? DEFAULTS.tone,
        userName: readStr(incoming.userName) ?? "",
        userAbout: readStr(incoming.userAbout) ?? "",
      };
      await writeSoulFields(fields);
      sendJson(res, 200, {
        ok: true,
        message:
          "Saved. The agent reads these on the next turn — no restart needed. Start a new chat to see the change.",
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

function readStr(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

async function resolveWorkspaceDir(): Promise<string> {
  // Read alien.json's agents.defaults.workspace, fall back to
  // <state-dir>/workspace.
  const stateDir = resolveStateDir();
  const configPath = path.join(stateDir, "alien.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as {
      agents?: { defaults?: { workspace?: unknown } };
    };
    const ws = parsed.agents?.defaults?.workspace;
    if (typeof ws === "string" && ws.trim().length > 0) {
      return ws;
    }
  } catch {
    // fall through
  }
  return path.join(stateDir, "workspace");
}

async function readSoulFields(): Promise<SoulFields> {
  const wsDir = await resolveWorkspaceDir();
  const result: SoulFields = { ...DEFAULTS };
  try {
    const soul = await fs.readFile(path.join(wsDir, "SOUL.md"), "utf8");
    const parsed = parseFromMarkdown(soul);
    if (parsed.name) result.name = parsed.name;
    if (parsed.purpose) result.purpose = parsed.purpose;
    if (parsed.tone) result.tone = parsed.tone;
  } catch {
    // file may not exist — use defaults
  }
  try {
    const identity = await fs.readFile(path.join(wsDir, "IDENTITY.md"), "utf8");
    const parsed = parseFromMarkdown(identity);
    if (parsed.role) result.role = parsed.role;
    if (parsed.name && !result.name) result.name = parsed.name;
  } catch {
    // optional
  }
  try {
    const user = await fs.readFile(path.join(wsDir, "USER.md"), "utf8");
    const parsed = parseFromMarkdown(user);
    if (parsed.userName) result.userName = parsed.userName;
    if (parsed.userAbout) result.userAbout = parsed.userAbout;
  } catch {
    // optional
  }
  return result;
}

async function writeSoulFields(fields: SoulFields): Promise<void> {
  const wsDir = await resolveWorkspaceDir();
  await fs.mkdir(wsDir, { recursive: true });
  await fs.writeFile(path.join(wsDir, "SOUL.md"), renderSoulMd(fields), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.writeFile(path.join(wsDir, "IDENTITY.md"), renderIdentityMd(fields), {
    encoding: "utf8",
    mode: 0o600,
  });
  if (fields.userName || fields.userAbout) {
    await fs.writeFile(path.join(wsDir, "USER.md"), renderUserMd(fields), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

// ---- markdown render / parse ----

function renderSoulMd(f: SoulFields): string {
  return `# SOUL.md — ${f.name}'s soul

I am **${f.name}** — ${f.role}.

## My purpose

${f.purpose}

## How I operate

${f.tone}

## On capability gaps

When I hit something I lack the tools for, I emit a \`capability-broker\`
task instead of pretending. The operator can then approve building the
new capability through the self-coder.

## On irreversible actions

I never send messages, transact, or modify external state without an
explicit operator-set \`requiresApproval\` task, OR a clear instruction
in the project goal that authorizes it. Default is "ask first."
`;
}

function renderIdentityMd(f: SoulFields): string {
  return `# IDENTITY.md

- **Name:** ${f.name}
- **Role:** ${f.role}
- **Emoji:** 👾
- **Avatar:** alien-logo

## What I am

${f.role}.

## Soul (short form)

${f.purpose.split("\n")[0] ?? ""}
`;
}

function renderUserMd(f: SoulFields): string {
  return `# USER.md — Operator profile

- **Name:** ${f.userName || "(not set)"}
${
  f.userAbout
    ? `- **About:**\n\n${f.userAbout
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n")}`
    : ""
}
`;
}

/**
 * Best-effort parse of the previously-rendered SOUL/IDENTITY/USER files
 * so the form pre-fills with what's on disk. Tolerant of upstream
 * formats — falls back to the raw section body when a heading match
 * fails.
 */
function parseFromMarkdown(src: string): {
  name?: string;
  role?: string;
  purpose?: string;
  tone?: string;
  userName?: string;
  userAbout?: string;
} {
  const out: ReturnType<typeof parseFromMarkdown> = {};
  // - **Name:** Foo
  const nameMatch = src.match(/\*\*Name:\*\*\s+(.+)/);
  if (nameMatch) out.name = nameMatch[1]?.trim();
  const roleMatch = src.match(/\*\*Role:\*\*\s+(.+)/);
  if (roleMatch) out.role = roleMatch[1]?.trim();

  const sections = splitMarkdownSections(src);
  if (sections["my purpose"]) out.purpose = sections["my purpose"];
  if (sections["how i operate"]) out.tone = sections["how i operate"];
  if (sections["about"]) out.userAbout = sections["about"];

  // For USER.md, the "About:" bullet is multi-line indented under it.
  const aboutBulletMatch = src.match(/\*\*About:\*\*\s*\n\n((?: {2,}.+\n?)+)/);
  if (aboutBulletMatch) {
    const body = aboutBulletMatch[1]
      ?.split("\n")
      .map((l) => l.replace(/^\s{2}/, ""))
      .join("\n")
      .trim();
    if (body) out.userAbout = body;
  }
  // Operator name on USER.md
  if (!out.userName) {
    const userName = src.match(/^#\s+USER\.md[\s\S]*?\*\*Name:\*\*\s+(.+)/);
    if (userName) out.userName = userName[1]?.trim();
  }
  return out;
}

function splitMarkdownSections(src: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = src.split("\n");
  let current: { heading: string; body: string[] } | null = null;
  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (current) sections[current.heading] = current.body.join("\n").trim();
      current = { heading: headingMatch[1]!.toLowerCase().trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) sections[current.heading] = current.body.join("\n").trim();
  return sections;
}

// ---- HTML page ----

function renderHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Soul · Alien</title>
<style>${CSS}</style>
</head><body>
<div class="page">
  <p class="crumb"><a href="/">← Alien</a></p>
  <h1>👾 Who is your Alien?</h1>
  <p class="tag">Tell it who it is, what it's for, and a bit about you. It reads this on every turn — change it any time and the next conversation reflects it.</p>

  <form id="form" class="form">
    <label class="field">
      <div class="field-label">Name</div>
      <div class="field-hint">What it calls itself.</div>
      <input id="name" name="name" type="text" placeholder="Alien" autocomplete="off">
    </label>

    <label class="field">
      <div class="field-label">Role (one line)</div>
      <div class="field-hint">A short tagline. Shows up in headers.</div>
      <input id="role" name="role" type="text" placeholder="Personal AI workforce" autocomplete="off">
    </label>

    <label class="field">
      <div class="field-label">Purpose</div>
      <div class="field-hint">What it exists for. Be specific — this shapes every plan it makes.</div>
      <textarea id="purpose" name="purpose" rows="4" placeholder="Help me turn one prompt into a fully-working result…"></textarea>
    </label>

    <label class="field">
      <div class="field-label">How it should operate</div>
      <div class="field-hint">Tone, approval defaults, voice. The agent treats this as its operating manual.</div>
      <textarea id="tone" name="tone" rows="5" placeholder="Calm, capable, action-oriented. Honest about what it doesn't know. Never sends irreversible messages without asking."></textarea>
    </label>

    <fieldset class="grouped">
      <legend>About you</legend>
      <label class="field">
        <div class="field-label">Your name</div>
        <div class="field-hint">How it should address you.</div>
        <input id="userName" name="userName" type="text" placeholder="Alex" autocomplete="off">
      </label>
      <label class="field">
        <div class="field-label">Context about you</div>
        <div class="field-hint">Anything it should know about you, your work, your style.</div>
        <textarea id="userAbout" name="userAbout" rows="3" placeholder="I'm a solo founder; I move fast and prefer brief replies."></textarea>
      </label>
    </fieldset>

    <button id="save" type="submit" class="primary">Save</button>
    <div id="status" class="status"></div>
  </form>
</div>
${script()}
</body></html>`;
}

const CSS = `
  :root {
    --bg: #faf8f4; --ink: #1a1714; --muted: #6b6258; --line: #e6dfd2;
    --gold: #b8923c; --gold-deep: #8e6e22; --ok: #2f7a4b; --err: #b53939;
    --field: #fff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 32px 20px 80px; }
  .page { max-width: 680px; margin: 0 auto; }
  .crumb { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
  .crumb a { color: var(--gold-deep); text-decoration: none; }
  .crumb a:hover { text-decoration: underline; }
  h1 { font-size: 28px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 4px; }
  .tag { color: var(--muted); margin: 0 0 22px; font-size: 14px; }
  .form { background: #fff; border: 1px solid var(--line); border-radius: 12px;
    padding: 22px 24px; }
  .field { display: block; margin: 0 0 18px; }
  .field-label { font-weight: 600; font-size: 14px; margin: 0 0 2px; }
  .field-hint { font-size: 12px; color: var(--muted); margin: 0 0 6px; }
  input[type="text"], textarea { width: 100%; padding: 9px 11px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--field); font: inherit; color: var(--ink); font-size: 14px; }
  input:focus, textarea:focus { outline: 2px solid var(--gold); outline-offset: -1px; border-color: var(--gold); }
  textarea { resize: vertical; min-height: 70px; font-family: inherit; }
  fieldset.grouped { border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px;
    margin: 0 0 18px; }
  fieldset.grouped legend { padding: 0 6px; font-weight: 600; font-size: 13px; color: var(--gold-deep); }
  fieldset.grouped .field { margin-bottom: 12px; }
  fieldset.grouped .field:last-child { margin-bottom: 0; }
  .primary { background: var(--ink); color: #fff; border: 1px solid var(--ink); border-radius: 8px;
    padding: 11px 22px; font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
  .primary:hover { background: var(--gold-deep); border-color: var(--gold-deep); }
  .primary:disabled { opacity: .5; cursor: default; }
  .status { margin-top: 12px; font-size: 13px; color: var(--muted); min-height: 18px; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }
`;

function script(): string {
  return `<script>
(() => {
  const $ = (id) => document.getElementById(id);
  async function fetchJson(p, init) {
    const r = await fetch(p, init || {});
    let d = null; try { d = await r.json(); } catch {}
    return { status: r.status, data: d };
  }
  (async () => {
    const r = await fetchJson("/v1/soul", { method: "GET" });
    if (r.data) {
      const d = r.data;
      $("name").value = d.name || "";
      $("role").value = d.role || "";
      $("purpose").value = d.purpose || "";
      $("tone").value = d.tone || "";
      $("userName").value = d.userName || "";
      $("userAbout").value = d.userAbout || "";
    }
  })();
  $("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const payload = {
      name: $("name").value, role: $("role").value,
      purpose: $("purpose").value, tone: $("tone").value,
      userName: $("userName").value, userAbout: $("userAbout").value,
    };
    $("save").disabled = true;
    $("status").className = "status";
    $("status").textContent = "Saving…";
    const r = await fetchJson("/v1/soul", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    $("save").disabled = false;
    if (r.data && r.data.ok) {
      $("status").className = "status ok";
      $("status").textContent = r.data.message || "Saved.";
    } else {
      $("status").className = "status err";
      $("status").textContent = (r.data && r.data.error) || "Save failed.";
    }
  });
})();
</script>`;
}
