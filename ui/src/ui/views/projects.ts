import { html, nothing } from "lit";
import type { Project, TaskRecord } from "../../../../src/projects/types.js";
import type { StarterTemplate } from "../../../../src/templates/types.js";
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
type TemplatesResponse = { readonly templates?: StarterTemplate[] };

const POLL_INTERVAL_MS = 3_000;
const COLUMNS: ReadonlyArray<{
  status: TaskRecord["status"];
  label: string;
  hint: string;
}> = [
  { status: "backlog", label: "Needs your OK", hint: "Approve before the team starts" },
  { status: "queued", label: "Up next", hint: "Ready for the team to pick up" },
  { status: "in-progress", label: "Working on it", hint: "Someone is on this right now" },
  { status: "review", label: "For your review", hint: "Done — but wants you to look" },
  { status: "done", label: "Done", hint: "Finished" },
  { status: "blocked", label: "Stuck", hint: "You paused this" },
  { status: "failed", label: "Didn't work", hint: "Failed — click retry to try again" },
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
  /** Apply a template: fills name + goal in the new-project draft and opens the modal. */
  readonly useTemplate: (template: StarterTemplate) => void;
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
  templates: StarterTemplate[];
  /** Template id whose starterPrompt should be dispatched right after the project is created. */
  pendingTemplatePrompt: string | null;
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
    templates: [],
    pendingTemplatePrompt: null,
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

  async function loadTemplates(): Promise<void> {
    // Templates are static; load once per session.
    if (state.templates.length > 0) return;
    try {
      const res = await fetchFn(buildUrl("/v1/templates"), {
        method: "GET",
        headers: buildHeaders(),
        credentials: "same-origin",
      });
      if (!res.ok) return;
      const body = (await res.json()) as TemplatesResponse;
      state.templates = Array.isArray(body.templates) ? body.templates : [];
      notify();
    } catch {
      // Soft-fail — gallery just won't appear; nothing else breaks.
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
      void loadTemplates();
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
    state.pendingTemplatePrompt = null;
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
      const pendingPrompt = state.pendingTemplatePrompt;
      state.pendingTemplatePrompt = null;
      if (body?.project) {
        state.selectedProjectId = body.project.id;
      }
      await refresh();
      // If this project came from a template, dispatch the template's
      // starter prompt automatically so the user sees the team start
      // working on something concrete instead of a blank board.
      if (pendingPrompt && state.selectedProjectId) {
        state.promptDraft = pendingPrompt;
        notify();
        await submitPrompt();
      }
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

  function useTemplate(template: StarterTemplate): void {
    state.newProjectDraft = {
      name: template.defaultProjectName,
      goal: template.defaultGoal,
    };
    state.pendingTemplatePrompt = template.starterPrompt;
    state.newProjectOpen = true;
    state.newProjectError = null;
    notify();
  }

  async function archiveSelectedProject(): Promise<void> {
    if (!state.selectedProjectId) return;
    if (
      !confirm(
        "Close this project? Your team will stop working on it. You can find the saved tasks later but they won't run anymore.",
      )
    ) {
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
    useTemplate,
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
          <div class="card-title">Your AI team 👾</div>
          <div class="card-sub">
            Start a project, tell your team what to do, and watch the work move from left to right.
          </div>
        </div>
        <div class="row" style="gap: 8px;">
          <button class="btn" ?disabled=${state.loading} @click=${() => void props.store.refresh()}>
            ${state.loading ? "Refreshing…" : "Refresh"}
          </button>
          <button class="btn primary" @click=${() => props.store.openNewProject()}>
            + Start a project
          </button>
        </div>
      </div>
      ${state.error
        ? html`<div class="callout danger" style="margin-top: 12px;">
            ${friendlyError(state.error)}
          </div>`
        : nothing}
    </section>

    ${state.projects.length === 0 ? renderFirstRunEmptyState(state, props.store) : nothing}

    <section class="grid" style="margin-top: 16px;">
      <div class="card" style="min-width: 220px; max-width: 320px;">
        <div class="card-title">Your projects</div>
        ${state.projects.length === 0
          ? html`<div class="muted" style="margin-top: 12px;">
              Nothing yet — start a project above.
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
              ${state.projects.length === 0
                ? "Once you start a project, you'll see its workspace here."
                : "Pick a project on the left to see what your team is doing."}
            </div>`}
      </div>
    </section>

    ${state.newProjectOpen ? renderNewProjectPanel(state, props.store) : nothing}
  `;
}

function renderFirstRunEmptyState(state: ProjectsState, store: ProjectsStore) {
  return html`
    <section class="card" style="margin-top: 16px; text-align: center;">
      <div style="font-size: 32px; margin-bottom: 8px;">👾</div>
      <div class="card-title">Welcome to your AI team</div>
      <div class="card-sub" style="max-width: 560px; margin: 8px auto;">
        Think of Alien as a small team of AI workers you can hire on demand. Tell them what you want
        — write a brief, send emails, plan a campaign — and they break the job into steps and do it.
        You stay in control: every step is visible on a board, and big actions wait for your
        approval.
      </div>
      <div class="row" style="gap: 8px; justify-content: center; margin-top: 16px;">
        <button class="btn primary" @click=${() => store.openNewProject()}>
          Start a blank project
        </button>
      </div>
    </section>
    ${state.templates.length > 0 ? renderTemplatesGallery(state.templates, store) : nothing}
  `;
}

function renderTemplatesGallery(templates: StarterTemplate[], store: ProjectsStore) {
  return html`
    <section style="margin-top: 16px;">
      <div
        style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px;"
      >
        <div style="font-weight: 600; font-size: 15px;">Or try one of these</div>
        <div class="muted" style="font-size: 12px;">
          Pick a template — your team starts working immediately.
        </div>
      </div>
      <div
        style="display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));"
      >
        ${templates.map((t) => renderTemplateCard(t, store))}
      </div>
    </section>
  `;
}

function renderTemplateCard(template: StarterTemplate, store: ProjectsStore) {
  return html`
    <div
      class="card template-card"
      style="padding: 14px; display: flex; flex-direction: column; gap: 8px;"
    >
      <div style="font-size: 24px;">${template.icon ?? "✨"}</div>
      <div style="font-weight: 600; font-size: 14px;">${template.name}</div>
      <div class="muted" style="font-size: 12px;">${template.tagline}</div>
      <div style="font-size: 12px; flex: 1;">${template.description}</div>
      ${template.requires.length > 0
        ? html`<div class="muted" style="font-size: 11px;">
            Needs: ${template.requires.join(", ")}
          </div>`
        : nothing}
      <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
        <button class="btn" @click=${() => store.useTemplate(template)}>Use this template</button>
      </div>
    </div>
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
          Started ${formatTimestamp(project.createdAt)} · by ${project.owner}
        </div>
      </div>
      <div class="row" style="gap: 8px;">
        <span class="chip ${projectStatusTone(project.status)}">
          ${friendlyProjectStatus(project.status)}
        </span>
        ${project.status !== "archived"
          ? html`<button class="btn" @click=${() => void store.archiveSelectedProject()}>
              Close project
            </button>`
          : nothing}
      </div>
    </div>

    ${renderPromptComposer(state, store)}
    ${state.detailError
      ? html`<div class="callout danger" style="margin-top: 12px;">
          ${friendlyError(state.detailError)}
        </div>`
      : nothing}
    ${state.selectedTasks.length === 0
      ? html`<div
          class="muted"
          style="margin-top: 16px; padding: 16px; text-align: center; border: 1px dashed var(--border, rgba(255,255,255,0.1)); border-radius: 8px;"
        >
          No work yet. Type a request above and your team will get to it.
        </div>`
      : html`
          <div
            class="kanban"
            style="display: grid; gap: 10px; margin-top: 16px; grid-template-columns: repeat(${COLUMNS.length}, minmax(180px, 1fr)); overflow-x: auto;"
          >
            ${COLUMNS.map((col) =>
              renderColumn(
                col.status,
                col.label,
                col.hint,
                tasksByStatus.get(col.status) ?? [],
                store,
              ),
            )}
          </div>
        `}
  `;
}

function renderPromptComposer(state: ProjectsState, store: ProjectsStore) {
  return html`
    <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 8px;">
      <label class="field">
        <span>What should your team work on?</span>
        <textarea
          rows="3"
          .value=${state.promptDraft}
          ?disabled=${state.promptBusy}
          placeholder="e.g. Write a short Tuesday brief on WebAssembly and Bun, then save it to my Desktop"
          @input=${(e: Event) => store.setPromptDraft((e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </label>
      ${state.promptError
        ? html`<div class="callout danger">${friendlyError(state.promptError)}</div>`
        : nothing}
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="muted" style="font-size: 12px;">
          Your team will break this into small steps and start working.
        </div>
        <button
          class="btn primary"
          ?disabled=${state.promptBusy || !state.promptDraft.trim()}
          @click=${() => void store.submitPrompt()}
        >
          ${state.promptBusy ? "Planning…" : "Send to the team"}
        </button>
      </div>
    </div>
  `;
}

function renderColumn(
  status: TaskRecord["status"],
  label: string,
  hint: string,
  tasks: TaskRecord[],
  store: ProjectsStore,
) {
  return html`
    <div class="card kanban-column" style="padding: 10px; min-height: 200px;" title="${hint}">
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
        ${friendlyRole(task.role)}${task.priority !== "normal"
          ? ` · ${friendlyPriority(task.priority)}`
          : ""}${task.attempts > 1 ? ` · tried ${task.attempts}×` : ""}
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
      title="Approve so the team can start this step"
      @click=${() => void store.approveTask(task.id)}
    >
      Looks good — go
    </button>`;
  }
  if (task.status === "failed" || task.status === "blocked") {
    return html`<button
      class="btn"
      style="font-size: 11px; padding: 4px 8px;"
      title="Put this back in the queue and try again"
      @click=${() => void store.retryTask(task.id)}
    >
      Try again
    </button>`;
  }
  if (task.status === "queued" || task.status === "in-progress" || task.status === "review") {
    return html`<button
      class="btn"
      style="font-size: 11px; padding: 4px 8px;"
      title="Stop the team from working on this for now"
      @click=${() => {
        const reason = prompt("Why pause this?", "paused by me");
        if (reason !== null) {
          void store.blockTask(task.id, reason || "paused");
        }
      }}
    >
      Pause
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
        <div class="card-title">Start a project</div>
        <div class="card-sub">
          A project is your workspace — give it a name and what you want done, and your AI team
          picks up the work from there.
        </div>
        <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 12px;">
          <label class="field">
            <span>What do you call this project?</span>
            <input
              .value=${state.newProjectDraft.name}
              ?disabled=${state.newProjectBusy}
              placeholder="e.g. Weekly newsletter, Inbox triage, Lead follow-ups"
              @input=${(e: Event) =>
                store.setNewProjectDraft({ name: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span>What's the goal? <span class="muted">(optional)</span></span>
            <textarea
              rows="3"
              .value=${state.newProjectDraft.goal}
              ?disabled=${state.newProjectBusy}
              placeholder="e.g. Send a polished weekly newsletter every Monday morning"
              @input=${(e: Event) =>
                store.setNewProjectDraft({ goal: (e.target as HTMLTextAreaElement).value })}
            ></textarea>
          </label>
        </div>
        ${state.newProjectError
          ? html`<div class="callout danger" style="margin-top: 12px;">
              ${friendlyError(state.newProjectError)}
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
            ${state.newProjectBusy ? "Starting…" : "Start project"}
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

function friendlyProjectStatus(status: Project["status"]): string {
  switch (status) {
    case "active":
      return "Running";
    case "paused":
      return "Paused";
    case "archived":
      return "Closed";
  }
}

function friendlyRole(role: TaskRecord["role"]): string {
  switch (role) {
    case "researcher":
      return "Researcher";
    case "writer":
      return "Writer";
    case "editor":
      return "Editor";
    case "publisher":
      return "Publisher";
    case "email-handler":
      return "Email";
  }
}

function friendlyPriority(priority: TaskRecord["priority"]): string {
  switch (priority) {
    case "urgent":
      return "urgent";
    case "high":
      return "important";
    case "low":
      return "low priority";
    case "normal":
      return "";
  }
}

/**
 * Translates raw error strings (often something like "gateway responded 401"
 * or "fetch failed") into a one-line, action-oriented message the user can
 * act on. Falls back to the original string if no pattern matches, so we
 * never hide a real signal.
 */
function friendlyError(raw: string): string {
  if (!raw) return "Something went wrong.";
  const lower = raw.toLowerCase();
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return "We couldn't authenticate. Try refreshing the page, or check your gateway token in Settings.";
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return "This account doesn't have permission for that action.";
  }
  if (lower.includes("404")) {
    return "We couldn't find that. It may have been removed — refresh and try again.";
  }
  if (lower.includes("anthropic_api_key") || lower.includes("anthropic api key")) {
    return "We need an Anthropic API key to plan your work. Add it in Settings → AI & Agents.";
  }
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("failed to fetch")) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (lower.includes("planner returned") || lower.includes("planner response")) {
    return "Your team got confused by that request. Try rewording it — short and concrete works best.";
  }
  if (lower.includes("topics is required")) {
    return "Please tell us what to research — add at least one topic.";
  }
  if (lower.includes("name is required")) {
    return "Please give the project a name.";
  }
  return raw;
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
