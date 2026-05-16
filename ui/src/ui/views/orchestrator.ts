import { html, nothing } from "lit";
import type { Run, TaskRecord } from "../../../../src/orchestrator/types.js";
import { resolveControlUiAuthHeader } from "../control-ui-auth.ts";
import { normalizeBasePath } from "../navigation.ts";

/**
 * Orchestrator runs UI — mirrors the macOS OrchestratorRunsWindow but as a
 * Lit-rendered tab in the gateway control UI. The store fetches the gateway
 * routes added in src/gateway/orchestrator-http.ts:
 *
 *   GET  /v1/orchestrator/runs            — list runs (newest first)
 *   GET  /v1/orchestrator/runs/<runId>    — single run detail
 *   POST /v1/orchestrator/runs            — start a new daily-research run
 *
 * The view polls every 2.5s while the tab is active so a running orchestrator
 * shows live task transitions. The store is created once per gateway-UI
 * session by the host renderer (app-render.ts) and survives tab switches.
 */

type AuthSource = Parameters<typeof resolveControlUiAuthHeader>[0];

type Draft = {
  topics: string;
  title: string;
  wordTarget: number;
  outputPath: string;
};

type StartRunResponse = {
  runId?: string;
  workflowId?: string;
  runPath?: string;
  outputPath?: string;
  error?: { message?: string };
};

const POLL_INTERVAL_MS = 2500;
const NEW_RUN_DEFAULT_DRAFT: Draft = {
  topics: "",
  title: "Daily Brief",
  wordTarget: 120,
  outputPath: "",
};

export type OrchestratorStore = {
  readonly state: OrchestratorState;
  readonly mount: () => void;
  readonly unmount: () => void;
  readonly refresh: () => Promise<void>;
  readonly select: (runId: string | null) => void;
  readonly setDraft: (patch: Partial<Draft>) => void;
  readonly openNewRun: () => void;
  readonly closeNewRun: () => void;
  readonly submitNewRun: () => Promise<void>;
};

export type OrchestratorState = {
  loading: boolean;
  error: string | null;
  runs: Run[];
  selectedRunId: string | null;
  newRunOpen: boolean;
  newRunBusy: boolean;
  newRunError: string | null;
  draft: Draft;
};

export type CreateOrchestratorStoreOptions = {
  readonly basePath: string;
  readonly auth: AuthSource;
  readonly onChange: () => void;
  readonly fetchImpl?: typeof fetch;
};

export function createOrchestratorStore(opts: CreateOrchestratorStoreOptions): OrchestratorStore {
  const fetchFn = opts.fetchImpl ?? fetch;
  const state: OrchestratorState = {
    loading: false,
    error: null,
    runs: [],
    selectedRunId: null,
    newRunOpen: false,
    newRunBusy: false,
    newRunError: null,
    draft: { ...NEW_RUN_DEFAULT_DRAFT },
  };

  let mountCount = 0;
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  function notify() {
    opts.onChange();
  }

  function buildUrl(suffix: string): string {
    const base = normalizeBasePath(opts.basePath ?? "");
    return base ? `${base}${suffix}` : suffix;
  }

  function buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json", ...(extra ?? {}) };
    const auth = resolveControlUiAuthHeader(opts.auth);
    if (auth) {
      headers.Authorization = auth;
    }
    return headers;
  }

  async function refresh(): Promise<void> {
    state.loading = true;
    state.error = null;
    notify();
    try {
      const res = await fetchFn(buildUrl("/v1/orchestrator/runs"), {
        method: "GET",
        headers: buildHeaders(),
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`gateway responded ${res.status}`);
      }
      const body = (await res.json()) as { runs?: Run[] };
      const runs = Array.isArray(body.runs) ? body.runs : [];
      state.runs = runs;
      if (state.selectedRunId && !runs.some((r) => r.id === state.selectedRunId)) {
        state.selectedRunId = null;
      }
      if (!state.selectedRunId && runs.length > 0) {
        state.selectedRunId = runs[0]!.id;
      }
    } catch (err) {
      state.error = stringifyError(err);
    } finally {
      state.loading = false;
      notify();
    }
  }

  function startPolling() {
    if (pollHandle !== null) return;
    pollHandle = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollHandle === null) return;
    clearInterval(pollHandle);
    pollHandle = null;
  }

  function mount() {
    mountCount += 1;
    if (mountCount === 1) {
      void refresh();
      startPolling();
    }
  }

  function unmount() {
    if (mountCount === 0) return;
    mountCount -= 1;
    if (mountCount === 0) {
      stopPolling();
    }
  }

  function select(runId: string | null) {
    if (state.selectedRunId === runId) return;
    state.selectedRunId = runId;
    notify();
  }

  function setDraft(patch: Partial<Draft>) {
    state.draft = { ...state.draft, ...patch };
    notify();
  }

  function openNewRun() {
    state.newRunOpen = true;
    state.newRunError = null;
    notify();
  }

  function closeNewRun() {
    state.newRunOpen = false;
    state.newRunBusy = false;
    notify();
  }

  async function submitNewRun(): Promise<void> {
    const topics = state.draft.topics
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (topics.length === 0) {
      state.newRunError = "Add at least one topic.";
      notify();
      return;
    }
    state.newRunBusy = true;
    state.newRunError = null;
    notify();
    try {
      const payload: Record<string, unknown> = {
        topics,
        title: state.draft.title.trim() || "Daily Brief",
        wordTarget: clampWordTarget(state.draft.wordTarget),
      };
      if (state.draft.outputPath.trim()) {
        payload.outputPath = state.draft.outputPath.trim();
      }
      const res = await fetchFn(buildUrl("/v1/orchestrator/runs"), {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as StartRunResponse | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `gateway responded ${res.status}`);
      }
      state.newRunOpen = false;
      state.draft = { ...NEW_RUN_DEFAULT_DRAFT };
      if (body?.runId) {
        state.selectedRunId = body.runId;
      }
      await refresh();
    } catch (err) {
      state.newRunError = stringifyError(err);
    } finally {
      state.newRunBusy = false;
      notify();
    }
  }

  return {
    state,
    mount,
    unmount,
    refresh,
    select,
    setDraft,
    openNewRun,
    closeNewRun,
    submitNewRun,
  };
}

export type OrchestratorProps = {
  readonly store: OrchestratorStore;
};

export function renderOrchestrator(props: OrchestratorProps) {
  const { state } = props.store;
  const selectedRun = state.selectedRunId
    ? (state.runs.find((r) => r.id === state.selectedRunId) ?? null)
    : null;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Quick briefs</div>
          <div class="card-sub">
            One-shot research jobs — give a few topics, your team writes a short briefing. For
            ongoing work, use Projects instead.
          </div>
        </div>
        <div class="row" style="gap: 8px;">
          <button class="btn" ?disabled=${state.loading} @click=${() => void props.store.refresh()}>
            ${state.loading ? "Refreshing…" : "Refresh"}
          </button>
          <button class="btn primary" @click=${() => props.store.openNewRun()}>+ New brief</button>
        </div>
      </div>
      ${state.error
        ? html`<div class="callout danger" style="margin-top: 12px;">
            ${friendlyError(state.error)}
          </div>`
        : nothing}
    </section>

    <section class="grid" style="margin-top: 16px;">
      <div class="card" style="min-width: 240px; max-width: 320px;">
        <div class="card-title">Recent briefs</div>
        ${state.runs.length === 0
          ? html`<div class="muted" style="margin-top: 12px;">
              No briefs yet. Click "New brief" to start one.
            </div>`
          : html`
              <div class="list" style="margin-top: 12px;">
                ${state.runs.map((run) => renderRunRow(run, state.selectedRunId, props.store))}
              </div>
            `}
      </div>
      <div class="card" style="flex: 1;">
        ${selectedRun
          ? renderRunDetail(selectedRun)
          : html`<div class="muted" style="padding: 12px;">
              Pick a brief on the left to see how your team is doing.
            </div>`}
      </div>
    </section>

    ${state.newRunOpen ? renderNewRunPanel(state, props.store) : nothing}
  `;
}

function renderRunRow(run: Run, selectedId: string | null, store: OrchestratorStore) {
  const succeeded = run.tasks.filter((t) => t.status === "succeeded").length;
  const total = run.tasks.length;
  const isSelected = run.id === selectedId;
  return html`
    <button
      class="list-item ${isSelected ? "active" : ""}"
      style="text-align: left; cursor: pointer; width: 100%;"
      @click=${() => store.select(run.id)}
    >
      <div class="list-main">
        <div class="list-title">
          <span class="chip ${runStatusToneClass(run.status)}"
            >${friendlyRunStatus(run.status)}</span
          >
          ${run.id}
        </div>
        <div class="list-sub muted">${succeeded} of ${total} steps done</div>
      </div>
    </button>
  `;
}

function renderRunDetail(run: Run) {
  const succeeded = run.tasks.filter((t) => t.status === "succeeded").length;
  const total = run.tasks.length;
  const outputPath = readMetadataString(run.metadata, "outputPath");
  return html`
    <div class="row" style="justify-content: space-between;">
      <div>
        <div class="card-title">${run.id}</div>
        <div class="card-sub">
          ${succeeded} of ${total} steps done · ${friendlyRunStatus(run.status)}
        </div>
      </div>
      <div>
        <span class="chip ${runStatusToneClass(run.status)}">${friendlyRunStatus(run.status)}</span>
      </div>
    </div>
    <div class="muted" style="margin-top: 6px; font-size: 12px;">
      Started ${formatTimestamp(run.createdAt)}
      ${run.startedAt ? ` · running since ${formatTimestamp(run.startedAt)}` : ""}
      ${run.completedAt ? ` · finished ${formatTimestamp(run.completedAt)}` : ""}
    </div>

    <div style="margin-top: 14px;">
      <div class="muted" style="font-weight: 600; margin-bottom: 6px;">Steps</div>
      <div class="list">${run.tasks.map((task) => renderTaskRow(task))}</div>
    </div>

    ${outputPath
      ? html`
          <div style="margin-top: 14px;">
            <div class="muted" style="font-weight: 600; margin-bottom: 6px;">Saved to</div>
            <div class="mono" style="word-break: break-all;">${outputPath}</div>
          </div>
        `
      : nothing}
  `;
}

function renderTaskRow(task: TaskRecord) {
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">
          <span class="chip ${taskStatusToneClass(task.status)}">
            ${friendlyTaskStatus(task.status)}
          </span>
          ${task.summary}
        </div>
        <div class="list-sub muted">
          ${friendlyRoleShort(task.role)}${task.attempts > 1 ? ` · tried ${task.attempts}×` : ""}
        </div>
        ${task.error
          ? html`<div class="callout danger" style="margin-top: 6px;">${task.error}</div>`
          : nothing}
      </div>
    </div>
  `;
}

function renderNewRunPanel(state: OrchestratorState, store: OrchestratorStore) {
  return html`
    <div
      class="modal-backdrop"
      style="position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 10000;"
      @click=${() => store.closeNewRun()}
    >
      <div
        class="card"
        style="min-width: 480px; max-width: 640px;"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div class="card-title">New brief</div>
        <div class="card-sub">
          List the topics you want covered. Your team will research each one, write a short summary,
          edit it, and save it for you.
        </div>

        <div
          class="stack"
          style="margin-top: 16px; gap: 12px; display: flex; flex-direction: column;"
        >
          <label class="field">
            <span>Topics <span class="muted">(separate with commas)</span></span>
            <input
              .value=${state.draft.topics}
              ?disabled=${state.newRunBusy}
              placeholder="e.g. WebAssembly, Bun, Rust async runtimes"
              @input=${(e: Event) =>
                store.setDraft({ topics: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>Title for the brief</span>
            <input
              .value=${state.draft.title}
              ?disabled=${state.newRunBusy}
              placeholder="e.g. Tuesday Brief"
              @input=${(e: Event) =>
                store.setDraft({ title: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>Roughly how long, per topic? <span class="muted">(40–600 words)</span></span>
            <input
              type="number"
              min="40"
              max="600"
              .value=${String(state.draft.wordTarget)}
              ?disabled=${state.newRunBusy}
              @input=${(e: Event) => {
                const next = Number((e.target as HTMLInputElement).value);
                if (Number.isFinite(next)) {
                  store.setDraft({ wordTarget: clampWordTarget(next) });
                }
              }}
            />
          </label>
          <label class="field">
            <span>Where to save it? <span class="muted">(optional)</span></span>
            <input
              .value=${state.draft.outputPath}
              ?disabled=${state.newRunBusy}
              placeholder="Leave blank to save somewhere sensible"
              @input=${(e: Event) =>
                store.setDraft({ outputPath: (e.target as HTMLInputElement).value })}
            />
          </label>
        </div>

        ${state.newRunError
          ? html`<div class="callout danger" style="margin-top: 12px;">
              ${friendlyError(state.newRunError)}
            </div>`
          : nothing}

        <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 16px;">
          <button class="btn" ?disabled=${state.newRunBusy} @click=${() => store.closeNewRun()}>
            Cancel
          </button>
          <button
            class="btn primary"
            ?disabled=${state.newRunBusy || !state.draft.topics.trim()}
            @click=${() => void store.submitNewRun()}
          >
            ${state.newRunBusy ? "Starting…" : "Start the brief"}
          </button>
        </div>
      </div>
    </div>
  `;
}

function friendlyRunStatus(status: Run["status"]): string {
  switch (status) {
    case "pending":
      return "Waiting to start";
    case "running":
      return "Working on it";
    case "succeeded":
      return "Done";
    case "failed":
      return "Didn't finish";
  }
}

function friendlyTaskStatus(status: TaskRecord["status"]): string {
  switch (status) {
    case "pending":
      return "waiting";
    case "running":
      return "working";
    case "succeeded":
      return "done";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
  }
}

function friendlyRoleShort(role: TaskRecord["role"]): string {
  switch (role) {
    case "researcher":
      return "researcher";
    case "writer":
      return "writer";
    case "editor":
      return "editor";
    case "publisher":
      return "publisher";
    case "email-handler":
      return "email";
    case "capability-broker":
      return "capability gap";
  }
}

function friendlyError(raw: string): string {
  if (!raw) return "Something went wrong.";
  const lower = raw.toLowerCase();
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return "We couldn't authenticate. Try refreshing the page or check your gateway token in Settings.";
  }
  if (lower.includes("anthropic_api_key") || lower.includes("anthropic api key")) {
    return "We need an Anthropic API key to start a brief. Add it in Settings → AI & Agents.";
  }
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("failed to fetch")) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (lower.includes("topics is required")) {
    return "Please add at least one topic.";
  }
  return raw;
}

function runStatusToneClass(status: Run["status"]): string {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "running":
      return "info";
    default:
      return "";
  }
}

function taskStatusToneClass(status: TaskRecord["status"]): string {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "running":
      return "info";
    case "skipped":
      return "muted";
    default:
      return "";
  }
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!metadata) return null;
  const raw = metadata[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function clampWordTarget(value: number): number {
  return Math.max(40, Math.min(600, Math.round(value)));
}

function stringifyError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err.trim();
  return "Unknown error";
}
