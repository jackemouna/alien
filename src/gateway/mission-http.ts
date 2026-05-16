import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { listExperts } from "../experts/registry.js";
import { DEPARTMENT_LABELS, DEPARTMENT_ORDER } from "../experts/types.js";
import type { Expert } from "../experts/types.js";
import { logWarn } from "../logger.js";
import { createAnthropicLlmClient } from "../orchestrator/llm-client.js";
import { runOneIteration, startGoalLoop } from "../projects/goal-loop.js";
import { listTasks, loadProject } from "../projects/store.js";
import type { Project, TaskRecord } from "../projects/types.js";
import { sendJson } from "./http-common.js";

/**
 * /mission/<projectId> — premium "Mission Control" board for one mission.
 *
 * Shows the project header (name, goal, status), the assigned expert
 * roster as a grid of cards, each expert's current task list, and a
 * tail of mission-scoped activity. Loopback-only.
 *
 *   GET  /experts                           — HTML roster page (read-only)
 *   GET  /mission/<projectId>               — HTML board
 *   GET  /v1/experts                        — list of all experts (JSON)
 *   GET  /v1/mission/<projectId>/state      — board state JSON
 */

const STATIC_PATHS = new Set(["/experts", "/v1/experts"]);

export function isMissionPath(pathname: string): boolean {
  if (STATIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/mission/") && pathname.length > "/mission/".length) return true;
  if (pathname.startsWith("/v1/mission/")) {
    const tail = pathname.slice("/v1/mission/".length);
    return tail.endsWith("/state") || tail.endsWith("/evaluate") || tail.endsWith("/replan");
  }
  return false;
}

export async function handleMissionRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isMissionPath(pathname)) return false;
  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, { error: { type: "forbidden", message: "Loopback-only" } });
    return true;
  }

  if (pathname === "/v1/experts") {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    const experts = await listExperts();
    sendJson(res, 200, { experts });
    return true;
  }

  if (pathname === "/experts") {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(renderRosterHtml());
    return true;
  }

  if (pathname.startsWith("/mission/")) {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    const projectId = pathname.slice("/mission/".length);
    if (!isSafeId(projectId)) {
      res.statusCode = 400;
      res.end("Bad project id");
      return true;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(renderMissionHtml(projectId));
    return true;
  }

  if (pathname.startsWith("/v1/mission/") && pathname.endsWith("/state")) {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    const projectId = pathname.slice("/v1/mission/".length, -"/state".length);
    if (!isSafeId(projectId)) {
      sendJson(res, 400, { error: { type: "invalid_request", message: "bad project id" } });
      return true;
    }
    // Lazy-start the auto-loop on first state read. No-op unless
    // ALIEN_GOAL_LOOP=1 is set, so default behavior is unchanged.
    startGoalLoop();
    const state = await readMissionState(projectId);
    if (!state) {
      sendJson(res, 404, {
        error: { type: "not_found", message: `project not found: ${projectId}` },
      });
      return true;
    }
    sendJson(res, 200, state);
    return true;
  }

  if (
    pathname.startsWith("/v1/mission/") &&
    (pathname.endsWith("/evaluate") || pathname.endsWith("/replan"))
  ) {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    const tail = pathname.endsWith("/evaluate") ? "/evaluate" : "/replan";
    const projectId = pathname.slice("/v1/mission/".length, -tail.length);
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
      const llm = await createAnthropicLlmClient({});
      const tasks = listTasks(projectsDir, projectId);
      const result = await runOneIteration({
        project,
        tasks,
        llm,
        projectsDir,
        forceReplan: tail === "/replan",
      });
      sendJson(res, 200, {
        ok: true,
        evaluation: result.evaluation,
        action: result.action,
      });
    } catch (err) {
      logWarn(
        `mission-http: ${tail.slice(1)} failed for ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  return false;
}

// ---- state ----

type ExpertTaskGroup = {
  readonly expert: Expert;
  readonly tasks: readonly TaskRecord[];
};

type MissionState = {
  readonly project: Project;
  readonly tasks: readonly TaskRecord[];
  readonly experts: readonly Expert[];
  readonly grouped: readonly ExpertTaskGroup[];
  readonly counts: {
    readonly total: number;
    readonly done: number;
    readonly inProgress: number;
    readonly queued: number;
    readonly blocked: number;
  };
};

async function readMissionState(projectId: string): Promise<MissionState | undefined> {
  const projectsDir = path.join(resolveStateDir(process.env), "projects");
  const project = loadProject(projectsDir, projectId);
  if (!project) return undefined;
  const tasks = listTasks(projectsDir, projectId);
  const all = await listExperts();
  const assignedIds = new Set(
    project.assignedExperts && project.assignedExperts.length > 0
      ? project.assignedExperts
      : all.map((e) => e.id),
  );
  const experts = all.filter((e) => assignedIds.has(e.id));
  const grouped: ExpertTaskGroup[] = experts.map((expert) => ({
    expert,
    tasks: tasks.filter((t) => taskBelongsToExpert(t, expert.id)),
  }));
  const counts = {
    total: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    inProgress: tasks.filter((t) => t.status === "in-progress").length,
    queued: tasks.filter((t) => t.status === "queued").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
  };
  return { project, tasks, experts, grouped, counts };
}

/**
 * Tasks the planner emits with an explicit `expertId` show up under that
 * expert's card on the Mission Control board. Legacy tasks without an
 * expertId (created before expert-aware planning landed) stay unrouted
 * and don't appear on any expert card.
 */
function taskBelongsToExpert(task: TaskRecord, expertId: string): boolean {
  return task.expertId === expertId;
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

// ---- HTML ----

const SHARED_CSS = `
  :root {
    color-scheme: light;
    --bg: #faf6ec; --bg-card: #ffffff;
    --line: #ece1c4; --line-strong: #d8c89d;
    --text: #1a1409; --text-dim: #5a5040; --text-mute: #8a7d62;
    --gold: #b89028; --gold-strong: #d9a936;
    --ok: #2b8a3e; --warn: #b06a16; --bad: #b8423a;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.55 -apple-system, "SF Pro Text", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased; }
  .shell { max-width: 1080px; padding: 40px 32px 80px; margin: 0 auto; }
  header.hero { display: flex; align-items: flex-end; justify-content: space-between;
    gap: 24px; margin-bottom: 28px; }
  .brand { font-size: 24px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
  .brand .glyph { font-size: 30px; }
  .subtitle { color: var(--text-mute); margin-top: 4px; font-size: 13px; }
  nav.quick { display: flex; gap: 8px; flex-wrap: wrap; }
  nav.quick a {
    text-decoration: none; color: var(--text-dim);
    background: var(--bg-card); border: 1px solid var(--line);
    padding: 8px 14px; border-radius: 8px; font-size: 13px;
    transition: color 0.15s, border-color 0.15s;
  }
  nav.quick a:hover { color: var(--gold); border-color: var(--line-strong); }
`;

function renderRosterHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>👾 Alien · Experts</title>
<style>
${SHARED_CSS}
  .summary { color: var(--text-mute); font-size: 13px; margin: 4px 0 28px; }
  details.dept { margin-bottom: 16px; }
  details.dept > summary {
    list-style: none; cursor: pointer; padding: 14px 16px;
    background: var(--bg-card); border: 1px solid var(--line);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: space-between;
    transition: border-color 0.15s;
  }
  details.dept > summary::-webkit-details-marker { display: none; }
  details.dept[open] > summary { border-color: var(--line-strong); border-radius: 10px 10px 0 0; }
  details.dept > summary:hover { border-color: var(--line-strong); }
  .dept-title { font-weight: 600; font-size: 15px; color: var(--text); }
  .dept-count { color: var(--text-mute); font-size: 12px; font-variant-numeric: tabular-nums; }
  .dept-chev { color: var(--text-mute); font-size: 11px; }
  details.dept[open] .dept-chev::after { content: " ▾"; }
  details.dept:not([open]) .dept-chev::after { content: " ▸"; }
  .roster {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 14px;
    padding: 14px;
    background: var(--bg-card);
    border: 1px solid var(--line-strong); border-top: none;
    border-radius: 0 0 10px 10px;
  }
  .ecard {
    background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
    padding: 16px 18px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .ecard:hover { border-color: var(--line-strong);
    box-shadow: 0 6px 24px -10px rgba(184,144,40,0.15); }
  .head { display: flex; align-items: center; gap: 10px; }
  .ava { font-size: 24px; }
  .name { font-weight: 600; font-size: 15px; }
  .titleln { color: var(--gold); font-size: 11px; letter-spacing: 0.04em;
    text-transform: uppercase; font-weight: 600; }
  .role { color: var(--text-dim); margin: 8px 0 0; font-size: 13px; }
  .purpose { color: var(--text-mute); margin: 8px 0 0; font-size: 12px; line-height: 1.5;
    border-left: 2px solid var(--line); padding-left: 10px; }
  .skills { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
  .skill { background: #faf5e4; border: 1px solid var(--line); border-radius: 999px;
    padding: 2px 9px; font-size: 11px; color: var(--text-dim); }
  .tone { color: var(--text-mute); font-size: 11px; margin-top: 10px; font-style: italic; }
</style>
</head>
<body>
<div class="shell">
  <header class="hero">
    <div>
      <div class="brand"><span class="glyph">👾</span> The team</div>
      <div class="subtitle">Alien isn't a single assistant — it's a company of experts.</div>
    </div>
    <nav class="quick">
      <a href="/dashboard">← Dashboard</a>
      <a href="/settings">Settings</a>
    </nav>
  </header>
  <div class="summary" id="summary">Loading roster…</div>
  <div id="departments"></div>
</div>
<script>
const DEPT_ORDER = ${JSON.stringify(DEPARTMENT_ORDER)};
const DEPT_LABELS = ${JSON.stringify(DEPARTMENT_LABELS)};
${rosterScript()}
</script>
</body>
</html>`;
}

function rosterScript(): string {
  return `
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;","<": "&lt;",">": "&gt;",'"': "&quot;","'": "&#39;",
})[c]);
async function load() {
  const r = await fetch("/v1/experts");
  const d = await r.json();
  const experts = d.experts || [];
  const groups = groupByDept(experts);
  $("summary").textContent = experts.length + " experts across " +
    Object.keys(groups).length + " departments. Click a department to expand.";
  const html = DEPT_ORDER
    .filter((id) => (groups[id] || []).length > 0)
    .map((id) => renderDept(id, groups[id]))
    .join("");
  $("departments").innerHTML = html;
}
function groupByDept(experts) {
  const out = {};
  for (const e of experts) {
    const d = e.department || "operations";
    (out[d] ||= []).push(e);
  }
  return out;
}
function renderDept(deptId, members) {
  // Open Leadership by default; the rest stay collapsed.
  const open = deptId === "leadership" ? "open" : "";
  return [
    '<details class="dept" ' + open + '>',
      '<summary>',
        '<span class="dept-title">' + esc(DEPT_LABELS[deptId] || deptId) + '</span>',
        '<span class="dept-count">' + members.length + ' · <span class="dept-chev"></span></span>',
      '</summary>',
      '<div class="roster">' + members.map(card).join("") + '</div>',
    '</details>',
  ].join("");
}
function card(e) {
  const skills = (e.skills || []).slice(0, 5).map((s) =>
    '<span class="skill">' + esc(s) + '</span>'
  ).join("");
  return [
    '<div class="ecard">',
      '<div class="head">',
        '<div class="ava">' + esc(e.avatar || "👤") + '</div>',
        '<div><div class="titleln">' + esc(e.title) + '</div>',
        '<div class="name">' + esc(e.name) + '</div></div>',
      '</div>',
      '<div class="role">' + esc(e.role) + '</div>',
      '<div class="purpose">' + esc(e.purpose) + '</div>',
      '<div class="skills">' + skills + '</div>',
      '<div class="tone">tone: ' + esc(e.tone) + '</div>',
    '</div>',
  ].join("");
}
load();
`;
}

function renderMissionHtml(projectId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>👾 Alien · Mission</title>
<style>
${SHARED_CSS}
  .mission-hero {
    background: linear-gradient(180deg, #fffaee 0%, #faf2da 100%);
    border: 1px solid var(--line-strong); border-radius: 14px;
    padding: 26px 28px; margin-bottom: 26px;
    box-shadow: 0 1px 2px rgba(184,144,40,0.04), 0 24px 80px -32px rgba(184,144,40,0.15);
  }
  .mhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .mname { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
  .mgoal { color: var(--text-dim); font-size: 14px; line-height: 1.5; margin: 0; }
  .status-pill {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 14px; border-radius: 999px; font-size: 12px;
    font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    background: #ebf6ec; color: var(--ok); border: 1px solid rgba(43,138,62,0.25);
  }
  .status-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
  .status-pill.paused { background: #fcefd9; color: var(--warn);
    border-color: rgba(176,106,22,0.30); }
  .status-pill.paused .dot { background: var(--warn); }
  .status-pill.achieved { background: #fbf2d4; color: var(--gold);
    border-color: rgba(184,144,40,0.40); }
  .status-pill.achieved .dot { background: var(--gold); }
  .status-pill.archived { background: #f4ecda; color: var(--text-mute);
    border-color: var(--line); }
  .status-pill.archived .dot { background: var(--text-mute); }
  .status-pill.needs-input { background: #fbe9e7; color: var(--bad);
    border-color: rgba(184,66,58,0.30); }
  .status-pill.needs-input .dot { background: var(--bad); }

  .eval {
    margin-top: 18px; padding: 14px 16px;
    background: rgba(255,255,255,0.6); border: 1px solid var(--line);
    border-radius: 10px;
  }
  .eval-head {
    display: flex; gap: 10px; align-items: baseline;
    margin-bottom: 6px;
  }
  .eval-status {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em;
    font-weight: 600; color: var(--gold);
  }
  .eval-status.achieved { color: var(--ok); }
  .eval-status.blocked { color: var(--bad); }
  .eval-meta { color: var(--text-mute); font-size: 11px; font-variant-numeric: tabular-nums; }
  .eval-reason { color: var(--text-dim); font-size: 13px; line-height: 1.5; }

  .actions {
    margin-top: 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
  }
  .action-btn {
    background: var(--bg-card); color: var(--text);
    border: 1px solid var(--line); border-radius: 8px;
    padding: 8px 14px; font: inherit; font-size: 13px; font-weight: 500;
    cursor: pointer; transition: border-color 0.12s, background 0.12s;
  }
  .action-btn:hover { border-color: var(--gold); }
  .action-btn:disabled { opacity: 0.5; cursor: default; }
  .action-btn.primary { background: var(--gold); color: #fffbef; border-color: var(--gold); }
  .action-btn.primary:hover { background: var(--gold-strong); border-color: var(--gold-strong); }
  .action-feedback { color: var(--text-mute); font-size: 12px; min-height: 16px; }
  .action-feedback.ok { color: var(--ok); }
  .action-feedback.err { color: var(--bad); }

  .stats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px; margin-top: 18px;
  }
  .stat-cell { background: rgba(255,255,255,0.6);
    border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
  .stat-cell .lbl { font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.14em; color: var(--text-mute); }
  .stat-cell .val { font-size: 18px; font-weight: 600; margin-top: 2px;
    color: var(--text); font-variant-numeric: tabular-nums; }

  h2.section { font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em;
    color: var(--gold); margin: 28px 0 12px; font-weight: 600; }

  .roster {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 14px;
  }
  details.dept { margin-bottom: 12px; }
  details.dept > summary {
    list-style: none; cursor: pointer; padding: 12px 14px;
    background: var(--bg-card); border: 1px solid var(--line);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: space-between;
    transition: border-color 0.15s;
  }
  details.dept > summary::-webkit-details-marker { display: none; }
  details.dept[open] > summary { border-color: var(--line-strong); border-radius: 8px 8px 0 0; }
  details.dept > summary:hover { border-color: var(--line-strong); }
  .dept-title { font-weight: 600; font-size: 14px; color: var(--text); }
  .dept-count { color: var(--text-mute); font-size: 11px; font-variant-numeric: tabular-nums; }
  .dept-chev { color: var(--text-mute); font-size: 11px; }
  details.dept[open] .dept-chev::after { content: " ▾"; }
  details.dept:not([open]) .dept-chev::after { content: " ▸"; }
  .dept-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
    padding: 12px;
    background: var(--bg-card);
    border: 1px solid var(--line-strong); border-top: none;
    border-radius: 0 0 8px 8px;
  }
  .ecard {
    background: var(--bg); border: 1px solid var(--line);
    border-radius: 10px; padding: 14px 16px;
  }
  .head { display: flex; align-items: center; gap: 10px; }
  .ava { font-size: 22px; }
  .titleln { color: var(--gold); font-size: 11px; letter-spacing: 0.04em;
    text-transform: uppercase; font-weight: 600; }
  .name { font-weight: 600; font-size: 14px; }
  .ecard .role { color: var(--text-dim); font-size: 12px; margin: 6px 0 0; }
  .ecard .tasks {
    margin-top: 10px; padding-top: 10px;
    border-top: 1px dashed var(--line); font-size: 13px;
  }
  .ecard .empty { color: var(--text-mute); font-style: italic; font-size: 11px; }
  .tline {
    display: flex; justify-content: space-between; gap: 8px;
    padding: 4px 0; color: var(--text-dim); font-size: 12px;
  }
  .tstatus {
    padding: 1px 8px; border-radius: 999px; font-size: 10px;
    background: var(--bg); border: 1px solid var(--line); color: var(--text-mute);
  }
  .tstatus.done { color: var(--ok); border-color: rgba(43,138,62,0.25); }
  .tstatus.in-progress { color: var(--gold); border-color: rgba(184,144,40,0.40); }
  .tstatus.queued { color: var(--text-mute); }
  .tstatus.blocked { color: var(--bad); border-color: rgba(184,66,58,0.30); }
</style>
</head>
<body>
<div class="shell">
  <header class="hero">
    <div>
      <div class="brand"><span class="glyph">👾</span> Mission</div>
      <div class="subtitle" id="subtitle">Loading…</div>
    </div>
    <nav class="quick">
      <a href="/dashboard">← Dashboard</a>
      <a href="/experts">The team</a>
      <a href="/activity">Activity</a>
    </nav>
  </header>

  <div class="mission-hero">
    <div class="mhead">
      <div>
        <h1 class="mname" id="mname">…</h1>
        <p class="mgoal" id="mgoal">Loading mission goal…</p>
      </div>
      <span class="status-pill" id="status-pill"><span class="dot"></span><span id="status-label">…</span></span>
    </div>
    <div class="stats" id="stats"></div>
    <div class="eval" id="eval-block" style="display:none;">
      <div class="eval-head">
        <span class="eval-status" id="eval-status">…</span>
        <span class="eval-meta" id="eval-meta"></span>
      </div>
      <div class="eval-reason" id="eval-reason"></div>
    </div>
    <div class="actions">
      <button class="action-btn" id="btn-evaluate" type="button">Check goal status</button>
      <button class="action-btn primary" id="btn-replan" type="button">Plan next batch</button>
      <span class="action-feedback" id="action-feedback"></span>
    </div>
  </div>

  <h2 class="section">Assigned experts</h2>
  <div id="roster">Loading the team…</div>
</div>

<script>
const PROJECT_ID = ${JSON.stringify(projectId)};
const DEPT_ORDER = ${JSON.stringify(DEPARTMENT_ORDER)};
const DEPT_LABELS = ${JSON.stringify(DEPARTMENT_LABELS)};
${missionScript()}
</script>
</body>
</html>`;
}

function missionScript(): string {
  return `
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;","<": "&lt;",">": "&gt;",'"': "&quot;","'": "&#39;",
})[c]);

async function load() {
  try {
    const r = await fetch("/v1/mission/" + encodeURIComponent(PROJECT_ID) + "/state");
    if (r.status === 404) { $("subtitle").textContent = "Mission not found."; return; }
    if (!r.ok) throw new Error("state " + r.status);
    const s = await r.json();
    render(s);
  } catch (err) {
    $("subtitle").textContent = "Could not load mission state.";
    console.error(err);
  }
}

function render(s) {
  $("mname").textContent = s.project.name;
  $("mgoal").textContent = s.project.goal;
  $("subtitle").innerHTML = "owner <strong>" + esc(s.project.owner) +
    "</strong> · launched " + new Date(s.project.createdAt).toLocaleString();
  const pill = $("status-pill");
  pill.className = "status-pill " + esc(s.project.status);
  $("status-label").textContent = s.project.status === "active" ? "Working on it" : s.project.status;

  const c = s.counts;
  $("stats").innerHTML = [
    cell("Tasks total", c.total),
    cell("Done", c.done),
    cell("In progress", c.inProgress),
    cell("Queued", c.queued),
    cell("Blocked", c.blocked),
    cell("Iterations", s.project.iterationCount || 0),
  ].join("");

  // Goal evaluation panel
  const ev = s.project.goalEvaluation;
  if (ev) {
    $("eval-block").style.display = "";
    const cls = ev.status === "achieved" ? "achieved" : ev.status === "blocked" ? "blocked" : "";
    const statusEl = $("eval-status");
    statusEl.className = "eval-status " + cls;
    statusEl.textContent = ev.status;
    const conf = Math.round((ev.confidence || 0) * 100);
    const evTs = ev.evaluatedAt ? new Date(ev.evaluatedAt).toLocaleString() : "";
    $("eval-meta").textContent = "confidence " + conf + "% · " + evTs +
      (ev.model ? " · " + ev.model : "");
    $("eval-reason").textContent = ev.reason;
  } else {
    $("eval-block").style.display = "none";
  }

  // Group expert cards by department. Auto-expand Leadership + any
  // department that currently has at least one task.
  const groups = {};
  for (const g of s.grouped || []) {
    const dept = (g.expert && g.expert.department) || "operations";
    (groups[dept] ||= []).push(g);
  }
  $("roster").innerHTML = DEPT_ORDER
    .filter((id) => (groups[id] || []).length > 0)
    .map((id) => renderDept(id, groups[id]))
    .join("");
}

function renderDept(deptId, groupsInDept) {
  const hasTasks = groupsInDept.some((g) => (g.tasks || []).length > 0);
  const open = deptId === "leadership" || hasTasks ? "open" : "";
  const cards = groupsInDept.map(renderExpertCard).join("");
  return [
    '<details class="dept" ' + open + '>',
      '<summary>',
        '<span class="dept-title">' + esc(DEPT_LABELS[deptId] || deptId) + '</span>',
        '<span class="dept-count">' + groupsInDept.length + ' · <span class="dept-chev"></span></span>',
      '</summary>',
      '<div class="dept-grid">' + cards + '</div>',
    '</details>',
  ].join("");
}

function renderExpertCard(group) {
  const e = group.expert;
  const tasks = group.tasks || [];
  const taskHtml = tasks.length === 0
    ? '<div class="empty">Waiting for the planner to assign a task.</div>'
    : tasks.map((t) =>
        '<div class="tline">' +
          '<span>' + esc(t.title) + '</span>' +
          '<span class="tstatus ' + esc(t.status) + '">' + esc(t.status) + '</span>' +
        '</div>'
      ).join("");
  return [
    '<div class="ecard">',
      '<div class="head">',
        '<div class="ava">' + esc(e.avatar || "👤") + '</div>',
        '<div><div class="titleln">' + esc(e.title) + '</div>',
        '<div class="name">' + esc(e.name) + '</div></div>',
      '</div>',
      '<div class="role">' + esc(e.role) + '</div>',
      '<div class="tasks">' + taskHtml + '</div>',
    '</div>',
  ].join("");
}

function cell(label, value) {
  return '<div class="stat-cell"><div class="lbl">' + esc(label) +
    '</div><div class="val">' + esc(value) + '</div></div>';
}

async function trigger(tail) {
  const fb = $("action-feedback");
  fb.className = "action-feedback";
  fb.textContent = tail === "evaluate" ? "Asking the evaluator…" : "Asking the planner for the next batch…";
  const btnEval = $("btn-evaluate");
  const btnReplan = $("btn-replan");
  btnEval.disabled = true; btnReplan.disabled = true;
  try {
    const r = await fetch("/v1/mission/" + encodeURIComponent(PROJECT_ID) + "/" + tail, {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error((d && d.error) || "Request failed (HTTP " + r.status + ")");
    fb.className = "action-feedback ok";
    fb.textContent = "Evaluator: " + (d.evaluation && d.evaluation.status || "ok") +
      " · action: " + (d.action || "idle");
    await load();
  } catch (err) {
    fb.className = "action-feedback err";
    fb.textContent = "Failed: " + (err && err.message || err);
  } finally {
    btnEval.disabled = false; btnReplan.disabled = false;
  }
}

$("btn-evaluate").addEventListener("click", () => trigger("evaluate"));
$("btn-replan").addEventListener("click", () => trigger("replan"));

load();
setInterval(load, 10000);
`;
}
