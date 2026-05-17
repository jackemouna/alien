import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { applySoulProposal } from "../experts/apply-proposal.js";
import { runReflection } from "../experts/reflection.js";
import { readSoulProposals, updateSoulProposalStatus } from "../experts/soul-proposals-store.js";
import { logWarn } from "../logger.js";
import { createLlmClientFromConfig } from "../orchestrator/llm-client-factory.js";
import { listTasks, loadProject } from "../projects/store.js";
import { sendJson } from "./http-common.js";

/**
 * /soul-proposals — review surface for the agent's self-improvement
 * proposals. The Reflection job (src/experts/reflection.ts) reads a
 * completed mission and proposes small edits to one or more experts'
 * souls; operators review them here and apply / reject / snooze.
 *
 * Routes (loopback-only):
 *   GET  /soul-proposals                      — HTML page
 *   GET  /v1/soul-proposals                   — list (newest first)
 *   POST /v1/soul-proposals/reflect/:projectId — fire reflection for one mission
 *   POST /v1/soul-proposals/:id/apply         — write override to ~/.alien/experts/<id>.json
 *   POST /v1/soul-proposals/:id/reject        — mark rejected + record note
 *   POST /v1/soul-proposals/:id/snooze        — mark snoozed (skip for now)
 */

export function isSoulProposalsPath(pathname: string): boolean {
  if (pathname === "/soul-proposals" || pathname === "/v1/soul-proposals") return true;
  if (pathname.startsWith("/v1/soul-proposals/")) return true;
  return false;
}

export async function handleSoulProposalsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isSoulProposalsPath(pathname)) return false;
  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { error: { type: "forbidden", message: "Loopback-only" } });
    return true;
  }

  if (pathname === "/soul-proposals") {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(renderHtml());
    return true;
  }

  if (pathname === "/v1/soul-proposals") {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    const proposals = await readSoulProposals();
    const newestFirst = [...proposals].toSorted((a, b) => (a.proposedAt > b.proposedAt ? -1 : 1));
    sendJson(res, 200, { proposals: newestFirst });
    return true;
  }

  if (pathname.startsWith("/v1/soul-proposals/reflect/")) {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    const projectId = pathname.slice("/v1/soul-proposals/reflect/".length);
    if (!isSafeId(projectId)) {
      sendJson(res, 400, { error: { type: "invalid_request", message: "bad project id" } });
      return true;
    }
    const projectsDir = path.join(resolveStateDir(process.env), "projects");
    const project = loadProject(projectsDir, projectId);
    if (!project) {
      sendJson(res, 404, {
        error: { type: "not_found", message: `project not found: ${projectId}` },
      });
      return true;
    }
    try {
      const llm = (await createLlmClientFromConfig()).client;
      const tasks = listTasks(projectsDir, projectId);
      const proposals = await runReflection({ llm, project, tasks });
      sendJson(res, 200, { ok: true, count: proposals.length, proposals });
    } catch (err) {
      logWarn(
        `soul-proposals: reflect failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // /v1/soul-proposals/<id>/(apply|reject|snooze)
  if (pathname.startsWith("/v1/soul-proposals/")) {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    const tail = pathname.slice("/v1/soul-proposals/".length);
    const lastSlash = tail.lastIndexOf("/");
    if (lastSlash <= 0) return false;
    const id = tail.slice(0, lastSlash);
    const action = tail.slice(lastSlash + 1);
    if (!isSafeId(id)) {
      sendJson(res, 400, { error: { type: "invalid_request", message: "bad proposal id" } });
      return true;
    }
    if (action !== "apply" && action !== "reject" && action !== "snooze") {
      sendJson(res, 400, {
        error: { type: "invalid_request", message: `unknown action: ${action}` },
      });
      return true;
    }
    const body = (await readJsonBodyTolerant(req)) ?? {};
    const note = typeof body.note === "string" ? body.note : undefined;

    if (action === "apply") {
      try {
        const existing = (await readSoulProposals()).find((p) => p.id === id);
        if (!existing) {
          sendJson(res, 404, { error: { type: "not_found", message: `unknown proposal: ${id}` } });
          return true;
        }
        const expert = await applySoulProposal(existing);
        const updated = await updateSoulProposalStatus(id, {
          status: "applied",
          ...(note ? { reviewerNote: note } : {}),
        });
        sendJson(res, 200, { ok: true, proposal: updated, expert });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }
    const status = action === "reject" ? "rejected" : "snoozed";
    const updated = await updateSoulProposalStatus(id, {
      status,
      ...(note ? { reviewerNote: note } : {}),
    });
    if (!updated) {
      sendJson(res, 404, { error: { type: "not_found", message: `unknown proposal: ${id}` } });
      return true;
    }
    sendJson(res, 200, { ok: true, proposal: updated });
    return true;
  }

  return false;
}

// ---- helpers ----

function methodNotAllowed(res: ServerResponse, allow: string): true {
  res.statusCode = 405;
  res.setHeader("Allow", allow);
  res.end();
  return true;
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(id);
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

async function readJsonBodyTolerant(
  req: IncomingMessage,
): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  const max = 64 * 1024;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > max) return undefined;
    chunks.push(buf);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore — body is optional
  }
  return undefined;
}

// ---- HTML ----

function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>👾 Alien · Soul proposals</title>
<style>
  :root {
    color-scheme: light;
    --bg: #faf6ec; --bg-card: #ffffff;
    --line: #ece1c4; --line-strong: #d8c89d;
    --text: #1a1409; --text-dim: #5a5040; --text-mute: #8a7d62;
    --gold: #b89028; --gold-strong: #d9a936;
    --ok: #2b8a3e; --warn: #b06a16; --bad: #b8423a;
    --add: #e7f5e9; --del: #fbe9e7;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.55 -apple-system, "SF Pro Text", system-ui, sans-serif; }
  .shell { max-width: 1080px; padding: 40px 32px 80px; margin: 0 auto; }
  header.hero { display: flex; align-items: flex-end; justify-content: space-between;
    gap: 24px; margin-bottom: 28px; }
  .brand { font-size: 24px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
  .brand .glyph { font-size: 30px; }
  .subtitle { color: var(--text-mute); font-size: 13px; margin-top: 4px; }
  nav.quick { display: flex; gap: 8px; flex-wrap: wrap; }
  nav.quick a, nav.quick button {
    text-decoration: none; color: var(--text-dim);
    background: var(--bg-card); border: 1px solid var(--line);
    padding: 8px 14px; border-radius: 8px; font-size: 13px;
    cursor: pointer; font-family: inherit;
  }
  nav.quick a:hover, nav.quick button:hover { color: var(--gold); border-color: var(--line-strong); }

  .empty { color: var(--text-mute); font-style: italic;
    background: var(--bg-card); border: 1px solid var(--line);
    border-radius: 10px; padding: 16px 20px; }

  .prop {
    background: var(--bg-card); border: 1px solid var(--line);
    border-radius: 12px; padding: 18px 20px; margin-bottom: 14px;
  }
  .prop.pending { border-left: 3px solid var(--gold); }
  .prop.applied { border-left: 3px solid var(--ok); opacity: 0.75; }
  .prop.rejected { border-left: 3px solid var(--bad); opacity: 0.5; }
  .prop.snoozed { border-left: 3px solid var(--warn); opacity: 0.6; }
  .phead { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .pwho { font-weight: 600; }
  .pfield { color: var(--gold); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.12em; }
  .pmeta { color: var(--text-mute); font-size: 11px; font-family: ui-monospace, "SF Mono", monospace; }
  .pstatus {
    padding: 1px 8px; border-radius: 999px; font-size: 10px;
    background: var(--bg); border: 1px solid var(--line); color: var(--text-mute);
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .pstatus.pending { color: var(--gold); border-color: rgba(184,144,40,0.40); }
  .pstatus.applied { color: var(--ok); border-color: rgba(43,138,62,0.30); }
  .pstatus.rejected { color: var(--bad); border-color: rgba(184,66,58,0.30); }
  .pstatus.snoozed { color: var(--warn); border-color: rgba(176,106,22,0.30); }

  .prationale { color: var(--text-dim); font-size: 13px; margin: 8px 0; }
  .diff { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
  .diff-side { background: var(--bg); border: 1px solid var(--line);
    border-radius: 8px; padding: 10px 12px; font-size: 12px;
    line-height: 1.5; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, "SF Mono", monospace; }
  .diff-side.before { background: var(--del); border-color: rgba(184,66,58,0.20); }
  .diff-side.after { background: var(--add); border-color: rgba(43,138,62,0.20); }
  .diff-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em;
    color: var(--text-mute); margin-bottom: 4px; font-family: -apple-system, system-ui, sans-serif; }

  .actions { display: flex; gap: 10px; margin-top: 14px; align-items: center; }
  .btn {
    background: var(--bg-card); border: 1px solid var(--line);
    border-radius: 8px; padding: 7px 14px; font: inherit; font-size: 13px;
    font-weight: 500; cursor: pointer; color: var(--text);
    transition: border-color 0.12s;
  }
  .btn:hover { border-color: var(--gold); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn.primary { background: var(--gold); color: #fffbef; border-color: var(--gold); }
  .btn.primary:hover { background: var(--gold-strong); border-color: var(--gold-strong); }
  .btn.danger { color: var(--bad); border-color: rgba(184,66,58,0.30); }
  .btn.danger:hover { background: #fdecec; border-color: var(--bad); }
  .ack { color: var(--text-mute); font-size: 12px; min-height: 16px; }
  .ack.ok { color: var(--ok); }
  .ack.err { color: var(--bad); }

  .reflect-form {
    background: var(--bg-card); border: 1px solid var(--line);
    border-radius: 12px; padding: 14px 18px; margin-bottom: 24px;
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
  }
  .reflect-form input {
    flex: 1; min-width: 220px; padding: 8px 11px;
    border: 1px solid var(--line); border-radius: 8px;
    background: var(--bg); font: inherit; font-size: 13px;
    color: var(--text); font-family: ui-monospace, "SF Mono", monospace;
  }
  .reflect-form input:focus { outline: 2px solid var(--gold); outline-offset: -1px; border-color: var(--gold); }
</style>
</head>
<body>
<div class="shell">
  <header class="hero">
    <div>
      <div class="brand"><span class="glyph">👾</span> Soul proposals</div>
      <div class="subtitle">Alien reading itself — proposed edits to your experts after each mission.</div>
    </div>
    <nav class="quick">
      <a href="/settings">← Settings</a>
      <a href="/dashboard">Dashboard</a>
    </nav>
  </header>

  <div class="reflect-form">
    <input id="project-id" type="text" placeholder="Project id (e.g. proj-1778...)" />
    <button class="btn primary" id="reflect-btn" type="button">Run reflection</button>
    <span class="ack" id="reflect-ack"></span>
  </div>

  <div id="list">Loading…</div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;","<": "&lt;",">": "&gt;",'"': "&quot;","'": "&#39;",
})[c]);

async function load() {
  const r = await fetch("/v1/soul-proposals");
  const d = await r.json();
  const list = d.proposals || [];
  if (list.length === 0) {
    $("list").innerHTML = '<div class="empty">No proposals yet. Run a mission, then trigger reflection on its project id above.</div>';
    return;
  }
  $("list").innerHTML = list.map(renderProp).join("");
  list.forEach((p) => bindProp(p));
}

function renderProp(p) {
  const fmt = (s) => s ? esc(s) : "(empty)";
  return [
    '<div class="prop ' + esc(p.status) + '" id="prop-' + esc(p.id) + '">',
      '<div class="phead">',
        '<div>',
          '<span class="pfield">' + esc(p.field) + '</span> · ',
          '<span class="pwho">' + esc(p.expertId) + '</span>',
        '</div>',
        '<span class="pstatus ' + esc(p.status) + '">' + esc(p.status) + '</span>',
      '</div>',
      '<div class="pmeta">' + esc(p.id) + ' · ' + new Date(p.proposedAt).toLocaleString() +
        (p.model ? ' · ' + esc(p.model) : '') + '</div>',
      p.rationale ? '<div class="prationale">' + esc(p.rationale) + '</div>' : '',
      '<div class="diff">',
        '<div><div class="diff-label">Before</div><div class="diff-side before">' + fmt(p.before) + '</div></div>',
        '<div><div class="diff-label">After</div><div class="diff-side after">' + fmt(p.after) + '</div></div>',
      '</div>',
      p.status === "pending" ? [
        '<div class="actions">',
          '<button class="btn primary" data-apply="' + esc(p.id) + '" type="button">Apply</button>',
          '<button class="btn" data-snooze="' + esc(p.id) + '" type="button">Snooze</button>',
          '<button class="btn danger" data-reject="' + esc(p.id) + '" type="button">Reject</button>',
          '<span class="ack" data-ack="' + esc(p.id) + '"></span>',
        '</div>',
      ].join("") : (p.reviewerNote
          ? '<div class="prationale" style="margin-top:10px"><strong>Note:</strong> ' + esc(p.reviewerNote) + '</div>'
          : ''),
    '</div>',
  ].join("");
}

function bindProp(p) {
  if (p.status !== "pending") return;
  for (const action of ["apply", "snooze", "reject"]) {
    const btn = document.querySelector('button[data-' + action + '="' + p.id + '"]');
    if (btn) btn.addEventListener("click", () => trigger(p.id, action));
  }
}

function setAck(id, kind, msg) {
  const el = document.querySelector('span[data-ack="' + id + '"]');
  if (!el) return;
  el.className = 'ack' + (kind ? ' ' + kind : '');
  el.textContent = msg || '';
}

async function trigger(id, action) {
  setAck(id, '', action + 'ing…');
  try {
    const r = await fetch("/v1/soul-proposals/" + encodeURIComponent(id) + "/" + action, {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error((d && d.error) || ("HTTP " + r.status));
    setAck(id, 'ok', '✓ ' + action + ' done');
    setTimeout(load, 600);
  } catch (err) {
    setAck(id, 'err', 'Failed: ' + (err && err.message || err));
  }
}

async function runReflect() {
  const projectId = $("project-id").value.trim();
  if (!projectId) { $("reflect-ack").className = "ack err"; $("reflect-ack").textContent = "Paste a project id first."; return; }
  $("reflect-btn").disabled = true;
  $("reflect-ack").className = "ack";
  $("reflect-ack").textContent = "Asking the reflector…";
  try {
    const r = await fetch("/v1/soul-proposals/reflect/" + encodeURIComponent(projectId), {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error((d && d.error) || ("HTTP " + r.status));
    $("reflect-ack").className = "ack ok";
    $("reflect-ack").textContent = "Reflector returned " + d.count + " proposal" + (d.count === 1 ? "" : "s") + ".";
    await load();
  } catch (err) {
    $("reflect-ack").className = "ack err";
    $("reflect-ack").textContent = "Failed: " + (err && err.message || err);
  } finally {
    $("reflect-btn").disabled = false;
  }
}

$("reflect-btn").addEventListener("click", runReflect);
load();
</script>
</body>
</html>`;
}
