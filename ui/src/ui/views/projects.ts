import { html, nothing } from "lit";
import {
  estimateRoleCostUsd,
  formatCostUsd,
  sumProjectCostUsd,
} from "../../../../src/projects/cost.js";
import type { Project, TaskRecord } from "../../../../src/projects/types.js";
import type { StarterTemplate } from "../../../../src/templates/types.js";
import { resolveControlUiAuthHeader } from "../control-ui-auth.ts";
import { normalizeBasePath } from "../navigation.ts";
import { DEMO_PROJECT, DEMO_TASKS, isDemoProject } from "./projects-demo.ts";

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

/**
 * One task as returned by the planner preview. Mirrors the shape of
 * TaskDraft + the planner's internal `_localId` hint that lets the
 * commit step preserve dependsOn edges across edits.
 */
type PlannedTask = {
  readonly _localId?: string;
  readonly id?: string;
  title: string;
  description: string;
  role: TaskRecord["role"];
  dependsOn: string[];
  input: Record<string, unknown>;
  priority?: TaskRecord["priority"];
  requiresApproval?: boolean;
};

type PlanPreview = {
  readonly summary?: string;
  tasks: PlannedTask[];
};

type PlanPreviewResponse = { readonly plan?: PlanPreview };

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
  /** Drop a task from the plan-preview modal before commit. */
  readonly removePlanTask: (taskIndex: number) => void;
  /** Commit the (possibly edited) plan and persist tasks. */
  readonly commitPlan: () => Promise<void>;
  /** Discard the plan preview without committing. */
  readonly cancelPlanPreview: () => void;
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
  /** When non-null, the plan-preview modal is open with these tasks waiting for approval. */
  planPreview: PlanPreview | null;
  planPreviewBusy: boolean;
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
    planPreview: null,
    planPreviewBusy: false,
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
      // Stage 1: ask the planner for a preview (the gateway returns the
      // proposed task DAG without persisting anything).
      const url = `/v1/projects/${encodeURIComponent(state.selectedProjectId)}/tasks/from-prompt`;
      const res = await fetchFn(buildUrl(url), {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({ prompt, preview: true }),
      });
      const body = (await res.json().catch(() => null)) as
        | (PlanPreviewResponse & { error?: { message?: string } })
        | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `gateway responded ${res.status}`);
      }
      const planRaw = body?.plan;
      if (!planRaw || !Array.isArray(planRaw.tasks) || planRaw.tasks.length === 0) {
        throw new Error("Your team couldn't break that down into steps. Try rewording it.");
      }
      // Stage 2: hand off to the preview modal. The store keeps the
      // plan in state; the user reviews/edits then calls commitPlan().
      state.planPreview = {
        ...(planRaw.summary ? { summary: planRaw.summary } : {}),
        tasks: planRaw.tasks.map((t) => ({
          ...t,
          dependsOn: Array.isArray(t.dependsOn) ? [...t.dependsOn] : [],
          input: t.input && typeof t.input === "object" ? { ...t.input } : {},
        })),
      };
    } catch (err) {
      state.promptError = stringifyError(err);
    } finally {
      state.promptBusy = false;
      notify();
    }
  }

  function removePlanTask(taskIndex: number): void {
    if (!state.planPreview) return;
    const removed = state.planPreview.tasks[taskIndex];
    if (!removed) return;
    const removedLocalId = removed._localId ?? removed.id ?? "";
    const nextTasks = state.planPreview.tasks
      .filter((_, i) => i !== taskIndex)
      .map((t) =>
        removedLocalId ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== removedLocalId) } : t,
      );
    state.planPreview = { ...state.planPreview, tasks: nextTasks };
    notify();
  }

  function cancelPlanPreview(): void {
    state.planPreview = null;
    state.planPreviewBusy = false;
    notify();
  }

  async function commitPlan(): Promise<void> {
    if (!state.selectedProjectId || !state.planPreview) return;
    if (state.planPreview.tasks.length === 0) {
      state.planPreviewBusy = false;
      notify();
      return;
    }
    state.planPreviewBusy = true;
    state.promptError = null;
    notify();
    try {
      const url = `/v1/projects/${encodeURIComponent(state.selectedProjectId)}/tasks/commit-plan`;
      const res = await fetchFn(buildUrl(url), {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({ plan: state.planPreview }),
      });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `gateway responded ${res.status}`);
      }
      state.planPreview = null;
      state.promptDraft = "";
      await refreshDetail(state.selectedProjectId);
    } catch (err) {
      state.promptError = stringifyError(err);
    } finally {
      state.planPreviewBusy = false;
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
    removePlanTask,
    commitPlan,
    cancelPlanPreview,
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
    ${state.planPreview ? renderPlanPreviewPanel(state, props.store) : nothing}
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
    ${renderDemoBoard()}
    ${state.templates.length > 0 ? renderTemplatesGallery(state.templates, store) : nothing}
  `;
}

function renderDemoBoard() {
  const tasksByStatus = groupByStatus([...DEMO_TASKS]);
  return html`
    <section style="margin-top: 16px;">
      <div
        class="callout"
        style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px; padding: 10px 14px;"
      >
        <span style="font-size: 18px;">👋</span>
        <div>
          <div style="font-weight: 600; font-size: 14px;">
            Here's what your team looks like working
          </div>
          <div class="muted" style="font-size: 12px;">
            This is a finished sample project. Click any card to read the worker's output. Your real
            projects will show up here.
          </div>
        </div>
      </div>
      <div class="card" style="padding: 16px;">
        <div class="row" style="justify-content: space-between; align-items: flex-start;">
          <div>
            <div class="card-title">
              ${DEMO_PROJECT.name}
              <span
                class="chip"
                style="margin-left: 8px; background: var(--accent-subtle, rgba(184,137,59,0.1)); color: var(--accent, #b8893b); font-weight: 600;"
                >Demo</span
              >
            </div>
            <div class="card-sub">${DEMO_PROJECT.goal}</div>
          </div>
          <div class="muted" style="font-size: 12px;">
            ${DEMO_TASKS.filter((t) => t.status === "done").length} of ${DEMO_TASKS.length} steps
            done
          </div>
        </div>
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
              null,
            ),
          )}
        </div>
      </div>
    </section>
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
  const totalSpent = sumProjectCostUsd(state.selectedTasks);
  return html`
    <div class="row" style="justify-content: space-between; align-items: flex-start;">
      <div>
        <div class="card-title">${project.name}</div>
        <div class="card-sub">${project.goal}</div>
        <div class="muted" style="margin-top: 4px; font-size: 12px;">
          Started ${formatTimestamp(project.createdAt)} · by
          ${project.owner}${totalSpent > 0
            ? html` ·
                <span title="Total Anthropic API spend on this project"
                  >spent ${formatCostUsd(totalSpent)}</span
                >`
            : nothing}
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
          Your team will draft a plan. You'll see the steps before anyone starts working.
        </div>
        <button
          class="btn primary"
          ?disabled=${state.promptBusy || !state.promptDraft.trim()}
          @click=${() => void store.submitPrompt()}
        >
          ${state.promptBusy ? "Planning…" : "Plan it"}
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
  store: ProjectsStore | null,
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

function renderTaskCard(task: TaskRecord, store: ProjectsStore | null) {
  const isDemo = isDemoProject(task.projectId);
  return html`
    <div
      class="task-card"
      style="border: 1px solid var(--border, rgba(255,255,255,0.08)); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px; cursor: ${task.output !=
        null || task.error
        ? "pointer"
        : "default"};"
      @click=${(e: Event) => {
        if (task.output == null && !task.error) return;
        const card = e.currentTarget as HTMLElement;
        const details = card.querySelector(".task-card__details") as HTMLElement | null;
        if (details) {
          details.style.display = details.style.display === "block" ? "none" : "block";
        }
      }}
    >
      <div style="font-size: 13px; font-weight: 500;">${task.title}</div>
      <div class="muted" style="font-size: 11px;">
        ${friendlyRole(task.role)}${task.priority !== "normal"
          ? ` · ${friendlyPriority(task.priority)}`
          : ""}${task.attempts > 1 ? ` · tried ${task.attempts}×` : ""}${typeof task.costUsd ===
          "number" && task.costUsd > 0
          ? ` · ${formatCostUsd(task.costUsd)}`
          : ""}
      </div>
      ${task.error
        ? html`<div class="callout danger" style="margin-top: 4px; font-size: 11px;">
            ${task.error}
          </div>`
        : nothing}
      ${task.output != null
        ? html`<div
            class="task-card__details muted"
            style="display: none; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border, rgba(0,0,0,0.1)); font-size: 11px; white-space: pre-wrap; max-height: 220px; overflow-y: auto;"
          >
            ${formatTaskOutput(task.output)}
          </div>`
        : nothing}
      ${store ? renderTaskActions(task, store) : isDemo ? renderDemoActions(task) : nothing}
    </div>
  `;
}

function renderTaskActions(task: TaskRecord, store: ProjectsStore) {
  if (task.status === "backlog" && task.requiresApproval) {
    return html`<button
      class="btn"
      style="font-size: 11px; padding: 4px 8px;"
      title="Approve so the team can start this step"
      @click=${(e: Event) => {
        e.stopPropagation();
        void store.approveTask(task.id);
      }}
    >
      Looks good — go
    </button>`;
  }
  if (task.status === "failed" || task.status === "blocked") {
    return html`<button
      class="btn"
      style="font-size: 11px; padding: 4px 8px;"
      title="Put this back in the queue and try again"
      @click=${(e: Event) => {
        e.stopPropagation();
        void store.retryTask(task.id);
      }}
    >
      Try again
    </button>`;
  }
  if (task.status === "queued" || task.status === "in-progress" || task.status === "review") {
    return html`<button
      class="btn"
      style="font-size: 11px; padding: 4px 8px;"
      title="Stop the team from working on this for now"
      @click=${(e: Event) => {
        e.stopPropagation();
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

function renderDemoActions(task: TaskRecord) {
  // Render the same action button shapes the user will see on a real
  // project, but disabled — so the affordances are visible without us
  // having to fake state changes for the demo.
  if (task.status === "backlog" && task.requiresApproval) {
    return html`<button
      class="btn"
      disabled
      style="font-size: 11px; padding: 4px 8px; opacity: 0.6;"
      title="Demo — start a real project to try this"
    >
      Looks good — go
    </button>`;
  }
  if (task.status === "queued" || task.status === "in-progress" || task.status === "review") {
    return html`<button
      class="btn"
      disabled
      style="font-size: 11px; padding: 4px 8px; opacity: 0.6;"
      title="Demo — start a real project to try this"
    >
      Pause
    </button>`;
  }
  return nothing;
}

function formatTaskOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (typeof output === "object") {
    const obj = output as Record<string, unknown>;
    // Common worker output shapes prefer their text-y field first.
    if (typeof obj.markdown === "string") return obj.markdown;
    if (typeof obj.summary === "string") return obj.summary;
    if (typeof obj.notes === "string") return obj.notes;
    if (typeof obj.text === "string") return obj.text;
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(output);
    }
  }
  return String(output);
}

function renderPlanPreviewPanel(state: ProjectsState, store: ProjectsStore) {
  const plan = state.planPreview;
  if (!plan) return nothing;
  return html`
    <div
      class="modal-backdrop"
      style="position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 10000;"
      @click=${() => store.cancelPlanPreview()}
    >
      <div
        class="card"
        style="min-width: 560px; max-width: 720px; max-height: 80vh; overflow-y: auto;"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div class="card-title">Your team's plan</div>
        <div class="card-sub">
          ${plan.summary ?? "Here's how your team wants to break down the work."} Review the steps,
          remove anything you don't want, then send.
        </div>

        <div style="margin-top: 16px; display: flex; flex-direction: column; gap: 10px;">
          ${plan.tasks.map((task, index) => renderPlanTaskRow(task, index, store))}
        </div>

        ${plan.tasks.length === 0
          ? html`<div class="callout" style="margin-top: 16px;">
              You removed all the steps. Cancel and try a different prompt.
            </div>`
          : nothing}

        <div class="row" style="justify-content: space-between; gap: 8px; margin-top: 20px;">
          <div class="muted" style="font-size: 12px;">
            ${plan.tasks.length} step${plan.tasks.length === 1 ? "" : "s"}.
            ${countWithApproval(plan.tasks) > 0
              ? html` ${countWithApproval(plan.tasks)} need your approval before running.`
              : ""}
            Estimated cost ${formatCostUsd(estimatePlanCostUsd(plan.tasks))}.
          </div>
          <div class="row" style="gap: 8px;">
            <button
              class="btn"
              ?disabled=${state.planPreviewBusy}
              @click=${() => store.cancelPlanPreview()}
            >
              Cancel
            </button>
            <button
              class="btn primary"
              ?disabled=${state.planPreviewBusy || plan.tasks.length === 0}
              @click=${() => void store.commitPlan()}
            >
              ${state.planPreviewBusy ? "Sending…" : "Send to the team"}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPlanTaskRow(task: PlannedTask, index: number, store: ProjectsStore) {
  return html`
    <div
      style="border: 1px solid var(--border, rgba(0,0,0,0.1)); border-radius: 8px; padding: 12px; display: flex; gap: 12px; align-items: flex-start;"
    >
      <div style="font-weight: 600; min-width: 24px; color: var(--accent, #b8893b);">
        ${index + 1}.
      </div>
      <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <div style="font-weight: 500; font-size: 14px;">${task.title}</div>
          <span class="chip">${friendlyRole(task.role)}</span>
          ${task.priority && task.priority !== "normal"
            ? html`<span class="chip ${task.priority === "urgent" ? "danger" : ""}"
                >${friendlyPriority(task.priority)}</span
              >`
            : nothing}
          ${task.requiresApproval ? html`<span class="chip warn">needs your OK</span>` : nothing}
        </div>
        <div class="muted" style="font-size: 12px;">${task.description}</div>
        ${task.dependsOn.length > 0
          ? html`<div class="muted" style="font-size: 11px;">
              Waits for: ${task.dependsOn.join(", ")}
            </div>`
          : nothing}
      </div>
      <button
        class="btn btn--icon"
        title="Remove this step"
        style="opacity: 0.6;"
        @click=${() => store.removePlanTask(index)}
      >
        ✕
      </button>
    </div>
  `;
}

function countWithApproval(tasks: readonly PlannedTask[]): number {
  let n = 0;
  for (const t of tasks) {
    if (t.requiresApproval) n += 1;
  }
  return n;
}

function estimatePlanCostUsd(tasks: readonly PlannedTask[]): number {
  // The planner adds one LLM call on top of the per-task work; bake
  // that in so the estimate reads honestly. Token estimates per role
  // come from src/projects/cost.ts.
  const PLANNER_CALL_USD = 0.005;
  let total = PLANNER_CALL_USD;
  for (const task of tasks) {
    total += estimateRoleCostUsd(task.role);
  }
  return total;
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
    case "achieved":
      return "success";
    case "needs-input":
      return "warn";
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
    case "achieved":
      return "Goal achieved";
    case "needs-input":
      return "Needs your input";
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
    case "capability-broker":
      return "Capability gap";
    case "self-coder":
      return "Self-coder";
    case "capability-runner":
      return "Live capability";
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
