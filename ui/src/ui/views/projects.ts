import { html, nothing } from "lit";
import type { Project, TaskRecord } from "../../../../src/projects/types.js";
import { resolveControlUiAuthHeader } from "../control-ui-auth.ts";
import { normalizeBasePath } from "../navigation.ts";

/**
 * Projects + Kanban board UI.
 *
 * Backs the Phase B `src/projects/` domain via the Phase C gateway routes:
 *
 *   GET    /v1/projects                              — list
 *   POST   /v1/projects                              — create
 *   GET    /v1/projects/<id>                         — project + tasks
 *   DELETE /v1/projects/<id>                         — archive
 *   POST   /v1/projects/<id>/tasks/from-prompt       — planner emits tasks
 *   POST   /v1/projects/<id>/tasks/<taskId>/approve  — backlog -> queued
 *   POST   /v1/projects/<id>/tasks/<taskId>/retry    — reset to queued
 *   POST   /v1/projects/<id>/tasks/<taskId>/block    — mark blocked
 *
 * The store polls every 3s to surface live task transitions driven by the
 * auto-pickup loop running inside the gateway process.
 */

type AuthSource = Parameters<typeof resolveControlUiAuthHeader>[0];

type ProjectDraft = {
  name: string;
  goal: string;
};

type ProjectListResponse = { readonly projects?: Project[] };
type ProjectDetailResponse = { readonly project?: Project; readonly tasks?: TaskRecord[] };

const POLL_INTERVAL_MS = 3_000;
const COLUMNS: ReadonlyArray<{ status: TaskRecord["status"]; label: string }> = [
  { status: "backlog", label: "Backlog (awaiting approval)" },
  { status: "queued", label: "Queued" },
  { status: "in-progress", label: "In progress" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
  { status: "blocked", label: "Blocked" },
  { status: "failed", label: "Failed" },
];

const NEW_PROJECT_DEFAULT_DRAFT: ProjectDraft = { name: "", goal: "" };

export type ProjectsStore = {
  readonly state: ProjectsState;
  readonly mount: () => void;
  readonly unmount: () => void;
  readonly refresh: () => Promise<void>;
  readonly select: (projectId: string | null) => void;
  readonly setNewProjectDraft: (patch: Partial<ProjectDraft>) => void;
  readonly openNewProject: () => void;
  readonly closeNewProject: () => void;
  readonly submitNewProject: () => Promise<void>;
  readonly setPromptDraft: (prompt: string) => void;
  readonly submitPrompt: () => Promise<void>;
  readonly approveTask: (taskId: string) => Promise<void>;
  readonly retryTask: (taskId: string) => Promise<void>;
  readonly blockTask: (taskId: string, reason: string) => Promise<void>;
  readonly archiveSelectedProject: () => Promise<void>;
};

export type ProjectsState = {
  loading: boolean;
  error: string | null;
  projects: Project[];
  selectedProjectId: string | null;
  selectedTasks: TaskRecord[];
  detailLoading: boolean;
  detailError: string | null;
  newProjectOpen: boolean;
  newProjectBusy: boolean;
  newProjectError: string | null;
  newProjectDraft: ProjectDraft;
  promptDraft: string;
  promptBusy: boolean;
  promptError: string | null;
};

export type CreateProjectsStoreOptions = {
  readonly basePath: string;
  readonly auth: AuthSource;
  readonly onChange: () => void;
  readonly fetchImpl?: typeof fetch;
};

export function createProjectsStore(opts: CreateProjectsStoreOptions): ProjectsStore {
  const fetchFn = opts.fetchImpl ?? fetch;
  const state: ProjectsState = {
    loading: false,
    error: null,
    projects: [],
    selectedProjectId: null,
    selectedTasks: [],
    detailLoading: false,
    detailError: null,
    newProjectOpen: false,
    newProjectBusy: false,
    newProjectError: null,
    newProjectDraft: { ...NEW_PROJECT_DEFAULT_DRAFT },
    promptDraft: "",
    promptBusy: false,
    promptError: null,
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
    if (auth) headers.Authorization = auth;
    return headers;
  }

  async function refreshList(): Promise<void> {
    state.loading = true;
    state.error = null;
    notify();
    try {
      const res = await fetchFn(buildUrl("/v1/projects"), {
        method: "GET",
        headers: buildHeaders(),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`gateway responded ${res.status}`);
      const body = (await res.json()) as ProjectListResponse;
      const projects = Array.isArray(body.projects) ? body.projects : [];
      state.projects = projects;
      if (state.selectedProjectId && !projects.some((p) => p.id === state.selectedProjectId)) {
        state.selectedProjectId = null;
        state.selectedTasks = [];
      }
      if (!state.selectedProjectId && projects.length > 0) {
        state.selectedProjectId = projects[0]!.id;
      }
    } catch (err) {
      state.error = stringifyError(err);
    } finally {
      state.loading = false;
      notify();
    }
    if (state.selectedProjectId) {
      await refreshDetail(state.selectedProjectId);
    }
  }

  async function refreshDetail(projectId: string): Promise<void> {
    state.detailLoading = true;
    state.detailError = null;
    notify();
    try {
      const res = await fetchFn(buildUrl(`/v1/projects/${encodeURIComponent(projectId)}`), {
        method: "GET",
        headers: buildHeaders(),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`gateway responded ${res.status}`);
      const body = (await res.json()) as ProjectDetailResponse;
      state.selectedTasks = Array.isArray(body.tasks) ? body.tasks : [];
    } catch (err) {
      state.detailError = stringifyError(err);
    } finally {
      state.detailLoading = false;
      notify();
    }
  }

  async function refresh(): Promise<void> {
    await refreshList();
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
    if (mountCount === 0) stopPolling();
  }

  function select(projectId: string | null) {
    if (state.selectedProjectId === projectId) return;
    state.selectedProjectId = projectId;
    state.selectedTasks = [];
    state.detailError = null;
    state.promptError = null;
    notify();
    if (projectId) {
      void refreshDetail(projectId);
    }
  }

  function setNewProjectDraft(patch: Partial<ProjectDraft>) {
    state.newProjectDraft = { ...state.newProjectDraft, ...patch };
    notify();
  }

  function openNewProject() {
    state.newProjectOpen = true;
    state.newProjectError = null;
    notify();
  }

  function closeNewProject() {
    state.newProjectOpen = false;
    state.newProjectBusy = false;
    state.newProjectDraft = { ...NEW_PROJECT_DEFAULT_DRAFT };
    notify();
  }

  async function submitNewProject(): Promise<void> {
    const name = state.newProjectDraft.name.trim();
    if (!name) {
      state.newProjectError = "Project name is required.";
      notify();
      return;
    }
    state.newProjectBusy = true;
    state.newProjectError = null;
    notify();
    try {
      const res = await fetchFn(buildUrl("/v1/projects"), {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({
          name,
          goal: state.newProjectDraft.goal.trim() || name,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        project?: Project;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `gateway responded ${res.status}`);
      }
      state.newProjectOpen = false;
      state.newProjectDraft = { ...NEW_PROJECT_DEFAULT_DRAFT };
      if (body?.project) {
        state.selectedProjectId = body.project.id;
      }
      await refresh();
    } catch (err) {
      state.newProjectError = stringifyError(err);
    } finally {
      state.newProjectBusy = false;
      notify();
    }
  }

  function setPromptDraft(prompt: string) {
    state.promptDraft = prompt;
    notify();
  }

  async function submitPrompt(): Promise<void> {
    if (!state.selectedProjectId) return;
    const prompt = state.promptDraft.trim();
    if (!prompt) {
      state.promptError = "Type a prompt to dispatch.";
      notify();
      return;
    }
    state.promptBusy = true;
    state.promptError = null;
    notify();
    try {
      const url = `/v1/projects/${encodeURIComponent(state.selectedProjectId)}/tasks/from-prompt`;
      const res = await fetchFn(buildUrl(url), {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({ prompt }),
      });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `gateway responded ${res.status}`);
      }
      state.promptDraft = "";
      await refreshDetail(state.selectedProjectId);
    } catch (err) {
      state.promptError = stringifyError(err);
    } finally {
      state.promptBusy = false;
      notify();
    }
  }

  async function postTaskAction(
    taskId: string,
    action: string,
    body?: Record<string, unknown>,
  ): Promise<void> {
    if (!state.selectedProjectId) return;
    const url = `/v1/projects/${encodeURIComponent(state.selectedProjectId)}/tasks/${encodeURIComponent(taskId)}/${action}`;
    try {
      const res = await fetchFn(buildUrl(url), {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(errBody?.error?.message ?? `gateway responded ${res.status}`);
      }
      await refreshDetail(state.selectedProjectId);
    } catch (err) {
      state.detailError = stringifyError(err);
      notify();
    }
  }

  async function approveTask(taskId: string): Promise<void> {
    await postTaskAction(taskId, "approve");
  }

  async function retryTask(taskId: string): Promise<void> {
    await postTaskAction(taskId, "retry");
  }

  async function blockTask(taskId: string, reason: string): Promise<void> {
    await postTaskAction(taskId, "block", { reason });
  }

  async function archiveSelectedProject(): Promise<void> {
    if (!state.selectedProjectId) return;
    if (!confirm("Archive this project? Tasks remain on disk but the pickup loop will skip it.")) {
      return;
    }
    const url = `/v1/projects/${encodeURIComponent(state.selectedProjectId)}`;
    try {
      const res = await fetchFn(buildUrl(url), {
        method: "DELETE",
        headers: buildHeaders(),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`gateway responded ${res.status}`);
      state.selectedProjectId = null;
      state.selectedTasks = [];
      await refresh();
    } catch (err) {
      state.error = stringifyError(err);
      notify();
    }
  }

  return {
    state,
    mount,
    unmount,
    refresh,
    select,
    setNewProjectDraft,
    openNewProject,
    closeNewProject,
    submitNewProject,
    setPromptDraft,
    submitPrompt,
    approveTask,
    retryTask,
    blockTask,
    archiveSelectedProject,
  };
}

export type ProjectsProps = { readonly store: ProjectsStore };

export function renderProjects(props: ProjectsProps) {
  const { state } = props.store;
  const selectedProject = state.selectedProjectId
    ? (state.projects.find((p) => p.id === state.selectedProjectId) ?? null)
    : null;
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Projects</div>
          <div class="card-sub">
            Persistent workspaces. The planner deposits tasks here; workers auto-pick them up.
          </div>
        </div>
        <div class="row" style="gap: 8px;">
          <button class="btn" ?disabled=${state.loading} @click=${() => void props.store.refresh()}>
            ${state.loading ? "Loading…" : "Refresh"}
          </button>
          <button class="btn primary" @click=${() => props.store.openNewProject()}>
            New project
          </button>
        </div>
      </div>
      ${state.error
        ? html`<div class="callout danger" style="margin-top: 12px;">${state.error}</div>`
        : nothing}
    </section>

    <section class="grid" style="margin-top: 16px;">
      <div class="card" style="min-width: 220px; max-width: 320px;">
        <div class="card-title">All projects</div>
        ${state.projects.length === 0
          ? html`<div class="muted" style="margin-top: 12px;">
              No projects yet. Click "New project" to get started.
            </div>`
          : html`
              <div class="list" style="margin-top: 12px;">
                ${state.projects.map((project) => renderProjectRow(project, state, props.store))}
              </div>
            `}
      </div>
      <div class="card" style="flex: 1;">
        ${selectedProject
          ? renderProjectDetail(selectedProject, state, props.store)
          : html`<div class="muted" style="padding: 12px;">
              Pick a project on the left, or create one to start dispatching prompts.
            </div>`}
      </div>
    </section>

    ${state.newProjectOpen ? renderNewProjectPanel(state, props.store) : nothing}
  `;
}

function renderProjectRow(project: Project, state: ProjectsState, store: ProjectsStore) {
  const isSelected = project.id === state.selectedProjectId;
  return html`
    <button
      class="list-item ${isSelected ? "active" : ""}"
      style="text-align: left; cursor: pointer; width: 100%;"
      @click=${() => store.select(project.id)}
    >
      <div class="list-main">
        <div class="list-title">
          <span class="chip ${projectStatusTone(project.status)}">${project.status}</span>
          ${project.name}
        </div>
        <div class="list-sub muted">${project.id}</div>
      </div>
    </button>
  `;
}

function renderProjectDetail(project: Project, state: ProjectsState, store: ProjectsStore) {
  const tasksByStatus = groupByStatus(state.selectedTasks);
  return html`
    <div class="row" style="justify-content: space-between; align-items: flex-start;">
      <div>
        <div class="card-title">${project.name}</div>
        <div class="card-sub">${project.goal}</div>
        <div class="muted" style="margin-top: 4px; font-size: 12px;">
          ${project.id} · owner ${project.owner} · created ${formatTimestamp(project.createdAt)}
        </div>
      </div>
      <div class="row" style="gap: 8px;">
        <span class="chip ${projectStatusTone(project.status)}">${project.status}</span>
        ${project.status !== "archived"
          ? html`<button class="btn" @click=${() => void store.archiveSelectedProject()}>
              Archive
            </button>`
          : nothing}
      </div>
    </div>

    ${renderPromptComposer(state, store)}
    ${state.detailError
      ? html`<div class="callout danger" style="margin-top: 12px;">${state.detailError}</div>`
      : nothing}

    <div
      class="kanban"
      style="display: grid; gap: 10px; margin-top: 16px; grid-template-columns: repeat(${COLUMNS.length}, minmax(180px, 1fr)); overflow-x: auto;"
    >
      ${COLUMNS.map((col) =>
        renderColumn(col.status, col.label, tasksByStatus.get(col.status) ?? [], store),
      )}
    </div>
  `;
}

function renderPromptComposer(state: ProjectsState, store: ProjectsStore) {
  return html`
    <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 8px;">
      <label class="field">
        <span>Dispatch a prompt (the planner breaks it into tasks)</span>
        <textarea
          rows="3"
          .value=${state.promptDraft}
          ?disabled=${state.promptBusy}
          placeholder="e.g. Draft a Tuesday brief on WebAssembly and Bun, then publish to ~/Desktop/brief.md"
          @input=${(e: Event) => store.setPromptDraft((e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </label>
      ${state.promptError ? html`<div class="callout danger">${state.promptError}</div>` : nothing}
      <div class="row" style="justify-content: flex-end;">
        <button
          class="btn primary"
          ?disabled=${state.promptBusy || !state.promptDraft.trim()}
          @click=${() => void store.submitPrompt()}
        >
          ${state.promptBusy ? "Planning…" : "Dispatch"}
        </button>
      </div>
    </div>
  `;
}

function renderColumn(
  status: TaskRecord["status"],
  label: string,
  tasks: TaskRecord[],
  store: ProjectsStore,
) {
  return html`
    <div class="card kanban-column" style="padding: 10px; min-height: 200px;">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div style="font-weight: 600; font-size: 13px;">${label}</div>
        <span class="chip ${taskStatusTone(status)}">${tasks.length}</span>
      </div>
      <div class="stack" style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
        ${tasks.length === 0
          ? html`<div class="muted" style="font-size: 12px;">—</div>`
          : tasks.map((task) => renderTaskCard(task, store))}
      </div>
    </div>
  `;
}

function renderTaskCard(task: TaskRecord, store: ProjectsStore) {
  return html`
    <div
      class="task-card"
      style="border: 1px solid var(--border, rgba(255,255,255,0.08)); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px;"
    >
      <div style="font-size: 13px; font-weight: 500;">${task.title}</div>
      <div class="muted" style="font-size: 11px;">
        ${task.role} · ${task.priority}${task.attempts > 1 ? ` · ${task.attempts} attempts` : ""}
      </div>
      ${task.error
        ? html`<div class="callout danger" style="margin-top: 4px; font-size: 11px;">
            ${task.error}
          </div>`
        : nothing}
      ${renderTaskActions(task, store)}
    </div>
  `;
}

function renderTaskActions(task: TaskRecord, store: ProjectsStore) {
  if (task.status === "backlog" && task.requiresApproval) {
    return html`<button
      class="btn"
      style="font-size: 11px; padding: 4px 8px;"
      @click=${() => void store.approveTask(task.id)}
    >
      Approve → queue
    </button>`;
  }
  if (task.status === "failed" || task.status === "blocked") {
    return html`<button
      class="btn"
      style="font-size: 11px; padding: 4px 8px;"
      @click=${() => void store.retryTask(task.id)}
    >
      Retry
    </button>`;
  }
  if (task.status === "queued" || task.status === "in-progress" || task.status === "review") {
    return html`<button
      class="btn"
      style="font-size: 11px; padding: 4px 8px;"
      @click=${() => {
        const reason = prompt("Block reason?", "operator paused");
        if (reason !== null) {
          void store.blockTask(task.id, reason || "blocked");
        }
      }}
    >
      Block
    </button>`;
  }
  return nothing;
}

function renderNewProjectPanel(state: ProjectsState, store: ProjectsStore) {
  return html`
    <div
      class="modal-backdrop"
      style="position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 10000;"
      @click=${() => store.closeNewProject()}
    >
      <div
        class="card"
        style="min-width: 420px; max-width: 560px;"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div class="card-title">Create project</div>
        <div class="card-sub">
          A project is a persistent workspace. Workers auto-pick up its tasks until you archive it.
        </div>
        <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 12px;">
          <label class="field">
            <span>Name</span>
            <input
              .value=${state.newProjectDraft.name}
              ?disabled=${state.newProjectBusy}
              placeholder="Daily research"
              @input=${(e: Event) =>
                store.setNewProjectDraft({ name: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>Goal (optional)</span>
            <textarea
              rows="3"
              .value=${state.newProjectDraft.goal}
              ?disabled=${state.newProjectBusy}
              placeholder="What outcome should this project drive toward?"
              @input=${(e: Event) =>
                store.setNewProjectDraft({ goal: (e.target as HTMLTextAreaElement).value })}
            ></textarea>
          </label>
        </div>
        ${state.newProjectError
          ? html`<div class="callout danger" style="margin-top: 12px;">
              ${state.newProjectError}
            </div>`
          : nothing}
        <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 16px;">
          <button
            class="btn"
            ?disabled=${state.newProjectBusy}
            @click=${() => store.closeNewProject()}
          >
            Cancel
          </button>
          <button
            class="btn primary"
            ?disabled=${state.newProjectBusy || !state.newProjectDraft.name.trim()}
            @click=${() => void store.submitNewProject()}
          >
            ${state.newProjectBusy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  `;
}

function groupByStatus(tasks: TaskRecord[]): Map<TaskRecord["status"], TaskRecord[]> {
  const map = new Map<TaskRecord["status"], TaskRecord[]>();
  for (const t of tasks) {
    const bucket = map.get(t.status) ?? [];
    bucket.push(t);
    map.set(t.status, bucket);
  }
  return map;
}

function projectStatusTone(status: Project["status"]): string {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warn";
    case "archived":
      return "";
  }
}

function taskStatusTone(status: TaskRecord["status"]): string {
  switch (status) {
    case "done":
      return "success";
    case "failed":
      return "danger";
    case "blocked":
      return "warn";
    case "in-progress":
      return "info";
    case "review":
      return "info";
    default:
      return "";
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function stringifyError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err.trim();
  return "Unknown error";
}
