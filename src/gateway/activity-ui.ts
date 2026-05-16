import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Live activity dashboard. Subscribes to /v1/activity/stream via
 * EventSource and renders each event as a card in a real-time feed.
 * Operator opens it once, leaves it on a side monitor, watches the
 * autonomous workforce work.
 *
 * Loopback-only. No auth.
 */

const UI_PATH = "/activity";

export function isActivityUiPath(pathname: string): boolean {
  return pathname === UI_PATH;
}

export async function handleActivityUiRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!isActivityUiPath(new URL(req.url ?? "/", "http://localhost").pathname)) return false;
  if (!isLoopbackRequest(req)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: { type: "forbidden", message: "Loopback-only page" } }));
    return true;
  }
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

function isLoopbackRequest(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.startsWith("::ffff:127.")
  );
}

function renderHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Activity · Alien</title>
<style>${CSS}</style>
</head><body>
<div class="page">
  <header>
    <p class="crumb"><a href="/">← Alien</a></p>
    <div class="title-row">
      <h1>👾 Live activity</h1>
      <div class="status">
        <span class="dot" id="status-dot"></span>
        <span id="status-text">connecting…</span>
      </div>
    </div>
    <p class="tag">What your AI workforce is doing, right now.</p>
  </header>

  <div class="toolbar">
    <label class="filter">
      <input type="checkbox" id="filter-claims" checked>
      <span>Task claims</span>
    </label>
    <label class="filter">
      <input type="checkbox" id="filter-tasks" checked>
      <span>Task lifecycle</span>
    </label>
    <label class="filter">
      <input type="checkbox" id="filter-loop" checked>
      <span>Goal loop</span>
    </label>
    <label class="filter">
      <input type="checkbox" id="filter-capabilities" checked>
      <span>Capabilities</span>
    </label>
    <div class="spacer"></div>
    <button id="clear" class="ghost-btn" type="button">Clear</button>
  </div>

  <div id="feed" class="feed"></div>
  <div id="empty" class="empty">Waiting for the first event…</div>
</div>
${pageScript()}
</body></html>`;
}

const CSS = `
  :root {
    --bg: #faf8f4; --ink: #1a1714; --muted: #6b6258; --line: #e6dfd2;
    --gold: #b8923c; --gold-deep: #8e6e22; --ok: #2f7a4b; --err: #b53939;
    --info: #3b4d7a; --code-bg: #f4ecd9;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 24px 20px 80px; }
  .page { max-width: 920px; margin: 0 auto; }
  .crumb { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
  .crumb a { color: var(--gold-deep); text-decoration: none; }
  .crumb a:hover { text-decoration: underline; }
  .title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  h1 { font-size: 28px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 4px; }
  .tag { color: var(--muted); margin: 0 0 18px; font-size: 14px; }
  .status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted);
    transition: background-color .25s; }
  .dot.live { background: var(--ok); box-shadow: 0 0 0 4px rgba(47,122,75,0.15); }
  .dot.err { background: var(--err); }

  .toolbar { display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
    background: #fff; border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 14px; margin: 0 0 18px; }
  .filter { display: flex; gap: 6px; align-items: center; font-size: 13px;
    color: var(--muted); cursor: pointer; }
  .filter input { accent-color: var(--gold); }
  .toolbar .spacer { flex: 1; }
  .ghost-btn { padding: 5px 12px; background: transparent; border: 1px solid var(--line);
    border-radius: 6px; font: inherit; font-size: 13px; color: var(--muted); cursor: pointer; }
  .ghost-btn:hover { border-color: var(--gold); color: var(--ink); }

  .feed { display: flex; flex-direction: column-reverse; gap: 8px; }
  .empty { color: var(--muted); font-size: 14px; font-style: italic; padding: 18px 4px; }
  .empty.hide { display: none; }
  .row {
    display: grid; grid-template-columns: 86px 24px 1fr; gap: 12px;
    align-items: baseline;
    padding: 10px 14px; background: #fff; border: 1px solid var(--line);
    border-radius: 8px;
    animation: slide-in .25s ease-out;
  }
  @keyframes slide-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .row .ts { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .row .icon { font-size: 16px; text-align: center; }
  .row .msg { font-size: 14px; }
  .row .meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .row .meta a { color: var(--gold-deep); text-decoration: none; }
  .row .meta a:hover { text-decoration: underline; }
  .row.kind-claim   { background: #f8f7f0; }
  .row.kind-done    { background: #f6fbf7; border-color: #c4e3cd; }
  .row.kind-failed  { background: #fdecec; border-color: #f4caca; }
  .row.kind-review  { background: #fbf6e8; border-color: #efd996; }
  .row.kind-loop    { background: #f3f0fb; border-color: #d6cef0; }
  .row.kind-cap     { background: #eef6fa; border-color: #c2dfec; }
  .row .pill { display: inline-block; padding: 1px 7px; border-radius: 99px;
    background: var(--code-bg); color: var(--gold-deep); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em; margin-left: 6px; vertical-align: 1px; }
  .cost { color: var(--gold-deep); font-weight: 500; }
`;

function pageScript(): string {
  // The page script subscribes to the SSE stream, parses each JSON line,
  // and renders a row. Friendly formatting per event kind.
  return `<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const feed = $("feed");
  const empty = $("empty");
  const dot = $("status-dot");
  const statusText = $("status-text");
  const MAX_ROWS = 300;

  const filters = {
    claims: $("filter-claims"),
    tasks: $("filter-tasks"),
    loop: $("filter-loop"),
    capabilities: $("filter-capabilities"),
  };
  Object.values(filters).forEach((f) => f.addEventListener("change", applyFilters));

  function applyFilters() {
    document.querySelectorAll(".row").forEach((row) => {
      const group = row.getAttribute("data-group");
      const show = filters[group] ? filters[group].checked : true;
      row.style.display = show ? "" : "none";
    });
  }

  $("clear").addEventListener("click", () => {
    feed.innerHTML = "";
    empty.classList.remove("hide");
  });

  function setStatus(state, text) {
    dot.className = "dot " + state;
    statusText.textContent = text;
  }

  function ago(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function fmtCost(usd) {
    if (typeof usd !== "number" || usd <= 0) return "";
    if (usd < 0.01) return "<$0.01";
    if (usd < 1) return "$" + usd.toFixed(3).replace(/0$/, "");
    return "$" + usd.toFixed(2);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Map each audit event kind to a friendly render spec.
  function format(evt) {
    const k = evt.kind || "";
    const p = evt.payload || {};
    const ts = ago(evt.ts || evt.timestamp);
    let icon = "•", msg = k, group = "tasks", cls = "";
    let meta = "";

    if (k === "projects.task.claimed") {
      icon = "🤖"; group = "claims"; cls = "kind-claim";
      msg = "<b>" + esc(p.role || "worker") + "</b> picked up <i>" + esc(p.title || p.taskId) + "</i>";
      meta = projectMeta(p);
    } else if (k === "projects.task.completed") {
      icon = "✓"; group = "tasks"; cls = "kind-done";
      const c = fmtCost(p.costUsd);
      msg = "<b>" + esc(p.role || "worker") + "</b> finished <i>" + esc(p.title || p.taskId) + "</i>" +
            (c ? ' <span class="cost">' + c + '</span>' : "");
      meta = projectMeta(p);
    } else if (k === "projects.task.in_review") {
      icon = "⏸"; group = "tasks"; cls = "kind-review";
      msg = "<b>" + esc(p.role || "worker") + "</b> needs your review on <i>" + esc(p.title || p.taskId) + "</i>";
      meta = projectMeta(p);
    } else if (k === "projects.task.failed") {
      icon = "✗"; group = "tasks"; cls = "kind-failed";
      msg = "<b>" + esc(p.role || "worker") + "</b> failed <i>" + esc(p.title || p.taskId) + "</i>";
      if (p.error) meta = '<span style="color:var(--err)">' + esc(p.error) + "</span>";
      else meta = projectMeta(p);
    } else if (k === "projects.task.blocked") {
      icon = "⛔"; group = "tasks"; cls = "kind-failed";
      msg = "<i>" + esc(p.title || p.taskId) + "</i> blocked";
      meta = projectMeta(p);
    } else if (k === "projects.task.approved") {
      icon = "👍"; group = "tasks"; cls = "kind-review";
      msg = "you approved <i>" + esc(p.title || p.taskId) + "</i>";
      meta = projectMeta(p);
    } else if (k === "projects.task.created") {
      icon = "+"; group = "tasks"; cls = "";
      msg = "new task <i>" + esc(p.title || p.taskId) + "</i> (" + esc(p.role) + ")";
      meta = projectMeta(p);
    } else if (k === "projects.project.created") {
      icon = "🆕"; group = "tasks"; cls = "";
      msg = "new project <b>" + esc(p.name || p.projectId) + "</b>";
    } else if (k === "projects.project.archived") {
      icon = "📦"; group = "tasks"; cls = "";
      msg = "project archived: <b>" + esc(p.projectId) + "</b>";
    } else if (k === "projects.project.iteration_started") {
      icon = "🔁"; group = "loop"; cls = "kind-loop";
      msg = "<b>iteration " + esc(p.iteration) + "</b> — " + esc(p.feedback || "planner re-fired");
    } else if (k === "projects.project.goal_achieved") {
      icon = "🎯"; group = "loop"; cls = "kind-done";
      msg = "<b>goal achieved</b> — " + esc(p.feedback || "");
    } else if (k === "projects.project.stuck") {
      icon = "🟡"; group = "loop"; cls = "kind-failed";
      msg = "<b>stuck</b> — " + esc(p.feedback || "operator review needed");
    } else if (k === "projects.capability.requested") {
      icon = "❓"; group = "capabilities"; cls = "kind-cap";
      msg = "planner requested <b>" + esc(p.integration) + "</b> — " + esc(p.why);
    } else if (k === "projects.capability.code_generated") {
      icon = "✍"; group = "capabilities"; cls = "kind-cap";
      const c = fmtCost(p.costUsd);
      msg = "self-coder wrote a stub for <b>" + esc(p.integration) + "</b>" +
            (c ? ' <span class="cost">' + c + '</span>' : "");
    } else if (k === "projects.capability.activated") {
      icon = "🟢"; group = "capabilities"; cls = "kind-cap";
      msg = "<b>" + esc(p.integration) + "</b> activated";
    } else if (k === "projects.capability.deactivated") {
      icon = "↩"; group = "capabilities"; cls = "kind-cap";
      msg = "<b>" + esc(p.integration) + "</b> rolled back" +
            (p.reason ? " — " + esc(p.reason) : "");
    } else if (k === "projects.capability.loaded") {
      icon = "⚡"; group = "capabilities"; cls = "kind-cap";
      msg = "<b>" + esc(p.integration) + "</b> hot-loaded into the gateway";
    } else if (k === "projects.capability.unloaded") {
      icon = "💤"; group = "capabilities"; cls = "kind-cap";
      msg = "<b>" + esc(p.integration) + "</b> unloaded from the runtime";
    } else {
      icon = "•";
      msg = '<span style="color:var(--muted)">' + esc(k) + "</span>";
    }
    return { ts, icon, msg, meta, group, cls };
  }

  function projectMeta(p) {
    if (!p || !p.projectId) return "";
    return 'project <a href="/projects/' + esc(p.projectId) + '">' + esc(p.projectId) + "</a>";
  }

  function render(evt) {
    const spec = format(evt);
    if (filters[spec.group] && !filters[spec.group].checked) return;
    const row = document.createElement("div");
    row.className = "row " + spec.cls;
    row.setAttribute("data-group", spec.group);
    row.innerHTML = '' +
      '<div class="ts">' + esc(spec.ts) + '</div>' +
      '<div class="icon">' + esc(spec.icon) + '</div>' +
      '<div><div class="msg">' + spec.msg + '</div>' +
        (spec.meta ? '<div class="meta">' + spec.meta + '</div>' : '') +
      '</div>';
    // Newest at top — using column-reverse, so we APPEND.
    feed.appendChild(row);
    while (feed.children.length > MAX_ROWS) {
      feed.removeChild(feed.firstChild);
    }
    empty.classList.add("hide");
  }

  let es = null;
  function connect() {
    setStatus("", "connecting…");
    es = new EventSource("/v1/activity/stream");
    es.addEventListener("open", () => setStatus("live", "live"));
    es.addEventListener("event", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        render(data);
      } catch (err) {
        console.warn("bad audit event:", ev.data, err);
      }
    });
    es.addEventListener("error", () => {
      setStatus("err", "reconnecting…");
      // EventSource auto-reconnects; we just update the UI.
    });
  }
  connect();
  window.addEventListener("beforeunload", () => { if (es) es.close(); });
})();
</script>`;
}
