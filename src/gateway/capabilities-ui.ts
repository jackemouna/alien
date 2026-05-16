import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Capabilities admin UI (Phase D2 follow-up). A standalone HTML page
 * served at `/capabilities` that lets the operator see + act on the
 * autonomous-loop's capability lifecycle:
 *
 *   - Pending: planner-raised requests waiting for a build
 *   - Generated: self-coder stubs awaiting activation review
 *   - Live: hot-loaded into the running gateway
 *   - Rolled back: historical, with reason for the trail
 *
 * Loopback-only — bypasses bearer auth on its own GET, but the page's
 * inline JS reads the gateway token from /v1/setup/status (also
 * loopback-only) and includes it in Authorization headers on the
 * POST calls (which DO require auth).
 */

const UI_PATH = "/capabilities";

export function isCapabilitiesUiPath(pathname: string): boolean {
  return pathname === UI_PATH;
}

export async function handleCapabilitiesUiRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!isCapabilitiesUiPath(new URL(req.url ?? "/", "http://localhost").pathname)) {
    return false;
  }
  if (!isLoopbackRequest(req)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: { type: "forbidden", message: "Loopback-only admin page" } }));
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
<title>Capabilities · Alien</title>
<style>${SHARED_CSS}</style>
</head><body>
<div class="page">
  <header>
    <p class="crumb"><a href="/">← Alien</a></p>
    <h1>👾 Self-coded capabilities</h1>
    <p class="tag">What your AI workforce can do — and what it's asked you to build.</p>
  </header>

  <section class="section">
    <div class="section-head">
      <h2>Pending requests</h2>
      <span class="muted" id="pending-count">…</span>
    </div>
    <p class="hint">The planner detected a gap and recorded it. Click <b>Build</b> to spawn the self-coder.</p>
    <div id="pending-list" class="cards"></div>
  </section>

  <section class="section">
    <div class="section-head">
      <h2>Awaiting review</h2>
      <span class="muted" id="fulfilled-count">…</span>
    </div>
    <p class="hint">Self-coder finished. Open the directory, look at the code, then <b>Activate</b> when ready.</p>
    <div id="fulfilled-list" class="cards"></div>
  </section>

  <section class="section">
    <div class="section-head">
      <h2>Live capabilities</h2>
      <span class="muted" id="live-count">…</span>
    </div>
    <p class="hint">Hot-loaded into the running gateway. The planner can dispatch to these via <code>capability-runner</code>.</p>
    <div id="live-list" class="cards"></div>
  </section>

  <section class="section">
    <div class="section-head">
      <h2>Rolled back</h2>
      <span class="muted" id="rolled-count">…</span>
    </div>
    <p class="hint">Forensics. Sandbox copies are preserved on disk; reasons (if given) below.</p>
    <div id="rolled-list" class="cards"></div>
  </section>

  <div id="toast" class="toast"></div>
  <div id="trace-modal" class="modal" role="dialog" aria-hidden="true">
    <div class="modal-card">
      <button class="close" type="button" id="trace-close" aria-label="Close">×</button>
      <h3 id="trace-title">Reasoning trace</h3>
      <pre id="trace-body"></pre>
    </div>
  </div>
</div>
${pageScript()}
</body></html>`;
}

const SHARED_CSS = `
  :root {
    --bg: #faf8f4; --ink: #1a1714; --muted: #6b6258; --line: #e6dfd2;
    --gold: #b8923c; --gold-deep: #8e6e22; --ok: #2f7a4b; --err: #b53939;
    --field: #fff; --code-bg: #f4ecd9;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 32px 20px 80px; }
  .page { max-width: 880px; margin: 0 auto; }
  header { margin: 0 0 28px; }
  .crumb { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
  .crumb a { color: var(--gold-deep); text-decoration: none; }
  .crumb a:hover { text-decoration: underline; }
  h1 { font-size: 30px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 4px; }
  .tag { color: var(--muted); margin: 0; font-size: 15px; }
  .section { background: #fff; border: 1px solid var(--line); border-radius: 12px;
    padding: 22px 24px; margin: 0 0 20px; }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; }
  .section h2 { font-size: 17px; font-weight: 600; margin: 0; }
  .hint { font-size: 13px; color: var(--muted); margin: 6px 0 14px; }
  .hint code { background: var(--code-bg); color: var(--gold-deep); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .cards { display: grid; gap: 10px; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .card.live { border-color: #c4e3cd; background: #f6fbf7; }
  .card.rolled { opacity: .7; }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 6px; }
  .card-name { font-weight: 600; font-size: 15px; margin: 0; }
  .card-meta { color: var(--muted); font-size: 12px; }
  .why { font-size: 14px; margin: 0 0 6px; }
  .sketch { font-size: 13px; color: var(--muted); margin: 0 0 6px; font-style: italic; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 11px;
    font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .badge.open { background: #f4ecd9; color: var(--gold-deep); }
  .badge.fulfilled { background: #ddeede; color: var(--ok); }
  .badge.in-progress { background: #e0e7f4; color: #3b4d7a; }
  .badge.rejected { background: #fdecec; color: var(--err); }
  .badge.active { background: #ddeede; color: var(--ok); }
  .badge.rolled-back { background: #f0ece4; color: var(--muted); }
  .actions { display: flex; gap: 8px; margin: 10px 0 0; flex-wrap: wrap; }
  button.btn { padding: 7px 14px; border: 1px solid var(--line); border-radius: 6px;
    background: #fff; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
    color: var(--ink); }
  button.btn:hover { border-color: var(--gold); }
  button.btn:disabled { opacity: .5; cursor: default; }
  button.btn.primary { background: var(--ink); color: #fff; border-color: var(--ink); }
  button.btn.primary:hover { background: var(--gold-deep); border-color: var(--gold-deep); }
  button.btn.danger { color: var(--err); border-color: #f4caca; }
  button.btn.danger:hover { background: #fdecec; border-color: var(--err); }
  .empty { color: var(--muted); font-size: 14px; font-style: italic; padding: 8px 0; }
  .path-snippet { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    color: var(--muted); background: var(--code-bg); padding: 2px 6px; border-radius: 4px; }
  .resolution { font-size: 12px; color: var(--muted); margin: 4px 0 0; }
  .toast { position: fixed; bottom: 24px; right: 24px; background: var(--ink); color: #fff;
    padding: 12px 18px; border-radius: 8px; font-size: 14px; display: none; max-width: 360px;
    box-shadow: 0 4px 22px rgba(0,0,0,.15); }
  .toast.show { display: block; }
  .toast.err { background: var(--err); }
  .modal { position: fixed; inset: 0; background: rgba(20,16,12,0.5); display: none;
    align-items: center; justify-content: center; padding: 24px; z-index: 100; }
  .modal.show { display: flex; }
  .modal-card { background: #fff; border-radius: 12px; padding: 22px 26px; max-width: 720px;
    width: 100%; max-height: 80vh; overflow: auto; position: relative; }
  .modal-card pre { background: #faf8f4; padding: 12px 14px; border-radius: 6px;
    font-size: 12px; overflow: auto; max-height: 60vh; line-height: 1.4; }
  .modal-card .close { position: absolute; top: 12px; right: 12px; background: transparent;
    border: 0; font-size: 22px; cursor: pointer; color: var(--muted); }
  .modal-card .close:hover { color: var(--ink); }
`;

function pageScript(): string {
  return `<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let GATEWAY_TOKEN = null;

  function toast(msg, kind) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast show" + (kind === "err" ? " err" : "");
    setTimeout(() => el.classList.remove("show"), 4000);
  }

  async function fetchJson(path, init) {
    const opts = Object.assign({ headers: {} }, init || {});
    opts.headers = Object.assign({ "content-type": "application/json" }, opts.headers);
    if (GATEWAY_TOKEN) opts.headers.authorization = "Bearer " + GATEWAY_TOKEN;
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }

  async function loadToken() {
    try {
      const r = await fetch("/v1/setup/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = await r.json();
      if (data && typeof data.gatewayToken === "string") {
        GATEWAY_TOKEN = data.gatewayToken;
      }
    } catch (err) {
      console.warn("could not load gateway token", err);
    }
  }

  async function loadAll() {
    const [requests, activated] = await Promise.all([
      fetchJson("/v1/capabilities", { method: "GET" }),
      fetchJson("/v1/capabilities/activated", { method: "GET" }),
    ]);
    render(requests.data, activated.data);
  }

  function render(reqResp, actResp) {
    const requests = (reqResp && reqResp.requests) || [];
    const activated = (actResp && actResp.activated) || [];
    const activatedByRequest = {};
    for (const a of activated) {
      activatedByRequest[a.fromRequestId] = a;
    }
    const pending = requests.filter((r) => r.status === "open");
    const fulfilled = requests.filter((r) => {
      if (r.status !== "fulfilled") return false;
      const a = activatedByRequest[r.id];
      return !a || a.status !== "active";
    });
    const live = activated.filter((a) => a.status === "active").map((a) => ({
      ...a,
      request: requests.find((r) => r.id === a.fromRequestId) || null,
    }));
    const rolled = activated.filter((a) => a.status === "rolled-back").map((a) => ({
      ...a,
      request: requests.find((r) => r.id === a.fromRequestId) || null,
    }));

    $("pending-count").textContent = pending.length === 0 ? "none" : pending.length + " open";
    $("fulfilled-count").textContent = fulfilled.length === 0 ? "none" : fulfilled.length + " awaiting";
    $("live-count").textContent = live.length === 0 ? "none" : live.length + " live";
    $("rolled-count").textContent = rolled.length === 0 ? "none" : rolled.length;

    $("pending-list").innerHTML = pending.length === 0
      ? '<div class="empty">No pending requests. The planner will add to this list when it hits a gap.</div>'
      : pending.map((r) => renderRequestCard(r, "pending")).join("");

    $("fulfilled-list").innerHTML = fulfilled.length === 0
      ? '<div class="empty">No stubs awaiting review.</div>'
      : fulfilled.map((r) => renderRequestCard(r, "fulfilled")).join("");

    $("live-list").innerHTML = live.length === 0
      ? '<div class="empty">No capabilities loaded yet.</div>'
      : live.map((a) => renderLiveCard(a)).join("");

    $("rolled-list").innerHTML = rolled.length === 0
      ? '<div class="empty">No rollbacks. Healthy.</div>'
      : rolled.map((a) => renderRolledCard(a)).join("");

    bindActions();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function renderRequestCard(r, kind) {
    const buildBtn = kind === "pending"
      ? '<button class="btn primary" data-action="build" data-id="' + esc(r.id) + '">Build</button>'
      : '';
    const activateBtn = kind === "fulfilled"
      ? '<button class="btn primary" data-action="activate" data-id="' + esc(r.id) + '">Activate</button>'
      : '';
    return [
      '<div class="card">',
        '<div class="card-head">',
          '<p class="card-name">' + esc(r.integration) + '</p>',
          '<span class="badge ' + r.status + '">' + r.status + '</span>',
        '</div>',
        '<p class="why">' + esc(r.why) + '</p>',
        r.sketch ? '<p class="sketch">Sketch: ' + esc(r.sketch) + '</p>' : '',
        r.resolution ? '<p class="resolution">' + esc(r.resolution) + '</p>' : '',
        '<p class="card-meta">' + esc(r.id) + ' · created ' + esc(r.createdAt) + '</p>',
        '<div class="actions">',
          buildBtn,
          activateBtn,
          '<button class="btn" data-action="trace" data-id="' + esc(r.id) + '">Trace</button>',
        '</div>',
      '</div>',
    ].join('');
  }

  function renderLiveCard(a) {
    const r = a.request || {};
    return [
      '<div class="card live">',
        '<div class="card-head">',
          '<p class="card-name">' + esc(a.integration) + '</p>',
          '<span class="badge active">active</span>',
        '</div>',
        r.why ? '<p class="why">' + esc(r.why) + '</p>' : '',
        '<p class="card-meta">activated ' + esc(a.activatedAt) + ' by ' + esc(a.activatedBy) + '</p>',
        '<div class="actions">',
          '<button class="btn danger" data-action="deactivate" data-id="' + esc(a.fromRequestId) + '">Rollback</button>',
          '<button class="btn" data-action="trace" data-id="' + esc(a.fromRequestId) + '">Trace</button>',
        '</div>',
      '</div>',
    ].join('');
  }

  function renderRolledCard(a) {
    return [
      '<div class="card rolled">',
        '<div class="card-head">',
          '<p class="card-name">' + esc(a.integration) + '</p>',
          '<span class="badge rolled-back">rolled back</span>',
        '</div>',
        a.rollbackReason ? '<p class="why">Reason: ' + esc(a.rollbackReason) + '</p>' : '',
        '<p class="card-meta">activated ' + esc(a.activatedAt) + ' · rolled back ' + esc(a.rollbackAt || "?") + '</p>',
        '<div class="actions">',
          '<button class="btn" data-action="trace" data-id="' + esc(a.fromRequestId) + '">Trace</button>',
        '</div>',
      '</div>',
    ].join('');
  }

  function bindActions() {
    document.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        const target = ev.currentTarget;
        const action = target.getAttribute('data-action');
        const id = target.getAttribute('data-id');
        if (!action || !id) return;
        if (action === 'build') return doBuild(id, target);
        if (action === 'activate') return doActivate(id, target);
        if (action === 'deactivate') return doDeactivate(id, target);
        if (action === 'trace') return showTrace(id);
      });
    });
  }

  async function doBuild(id, btn) {
    btn.disabled = true;
    btn.textContent = 'Building…';
    const r = await fetchJson('/v1/capabilities/' + encodeURIComponent(id) + '/build', { method: 'POST', body: '{}' });
    if (r.data && r.data.ok) {
      toast('Self-coder queued. Refreshing…');
      await loadAll();
    } else {
      btn.disabled = false;
      btn.textContent = 'Build';
      toast((r.data && r.data.error && r.data.error.message) || 'Build failed', 'err');
    }
  }

  async function doActivate(id, btn, forced) {
    btn.disabled = true;
    btn.textContent = forced ? 'Force-activating…' : 'Activating…';
    const r = await fetchJson('/v1/capabilities/' + encodeURIComponent(id) + '/activate', {
      method: 'POST',
      body: JSON.stringify(forced ? { force: true } : {}),
    });
    if (r.data && r.data.ok) {
      toast(r.data.message || 'Activated');
      await loadAll();
      return;
    }
    btn.disabled = false;
    btn.textContent = 'Activate';
    if (r.data && r.data.preflight && !r.data.preflight.ok) {
      showPreflight(id, r.data);
    } else {
      toast((r.data && r.data.error) || 'Activation failed', 'err');
    }
  }

  function showPreflight(id, payload) {
    const checks = (payload.preflight && payload.preflight.checks) || [];
    const lines = checks.map(function (c) {
      const sigil = c.passed ? '✓' : (c.warningOnly ? '⚠' : '✗');
      return sigil + ' ' + c.name + (c.detail ? ' — ' + c.detail : '');
    });
    const msg =
      'Pre-flight failed:\\n\\n' +
      lines.join('\\n') +
      '\\n\\nForce-activate anyway? (Only do this if you have read the generated code and trust it.)';
    if (window.confirm(msg)) {
      const btn = document.querySelector('button[data-action="activate"][data-id="' + id + '"]');
      if (btn) doActivate(id, btn, true);
    }
  }

  async function doDeactivate(id, btn) {
    const reason = window.prompt('Why are you rolling this back? (optional)') || '';
    btn.disabled = true;
    btn.textContent = 'Rolling back…';
    const r = await fetchJson('/v1/capabilities/' + encodeURIComponent(id) + '/deactivate', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    if (r.data && r.data.ok) {
      toast('Rolled back.');
      await loadAll();
    } else {
      btn.disabled = false;
      btn.textContent = 'Rollback';
      toast((r.data && r.data.error) || 'Rollback failed', 'err');
    }
  }

  async function showTrace(id) {
    const r = await fetchJson('/v1/capabilities/' + encodeURIComponent(id) + '/trace', { method: 'GET' });
    if (!r.data) {
      toast('Failed to load trace', 'err');
      return;
    }
    $("trace-title").textContent = 'Reasoning trace · ' + id;
    $("trace-body").textContent = JSON.stringify(r.data, null, 2);
    const modal = $("trace-modal");
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }

  $("trace-close").addEventListener('click', () => {
    const modal = $("trace-modal");
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  });
  $("trace-modal").addEventListener('click', (ev) => {
    if (ev.target === $("trace-modal")) $("trace-close").click();
  });

  (async () => {
    await loadToken();
    await loadAll();
  })();
})();
</script>`;
}
