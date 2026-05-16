/**
 * Orchestrator MVP — types shared across the coordinator, workflow runner,
 * and individual specialist workers.
 *
 * The model is intentionally narrow: a single Workflow run produces a
 * deterministic chain of Tasks, each owned by exactly one worker role. The
 * runner walks the chain top-to-bottom, persisting state after every task
 * so a crash or restart resumes from the next pending task.
 *
 * The first concrete workflow is `daily-research` (research → write → edit →
 * publish). Future verticals plug in by exporting a planner that produces
 * a list of Tasks and a worker registry for the role names referenced.
 */

export type WorkerRole =
  | "researcher"
  | "writer"
  | "editor"
  | "publisher"
  /**
   * Email specialist: reads inbox, drafts replies, sends mail. Backed by
   * src/integrations/gmail/worker.ts for the Gmail integration; v0.2+ may
   * add Outlook/IMAP behind the same role.
   */
  | "email-handler"
  /**
   * Capability broker (Phase B). The planner emits a task with this role
   * when it identifies a needed integration that does not currently exist
   * in the toolkit (e.g. "Stripe charge", "Calendly availability"). The
   * broker records the request and flips the parent project to
   * "needs-input" so the operator (or eventually a self-coding worker)
   * can resolve the gap.
   */
  | "capability-broker";

export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export type Task = {
  /** Stable id within a run (e.g. "research:topic-0", "write:summary-0"). */
  readonly id: string;
  /** Worker role responsible for this task. */
  readonly role: WorkerRole;
  /** Short human-readable description, useful for logs and audit trail. */
  readonly summary: string;
  /** Worker-specific input payload. The runner passes it through verbatim. */
  readonly input: Record<string, unknown>;
  /** Other task ids that must succeed before this one runs. */
  readonly dependsOn: readonly string[];
};

export type TaskRecord = Task & {
  status: TaskStatus;
  /** ISO timestamps, set by the runner. */
  startedAt?: string;
  completedAt?: string;
  /** Worker output stored by the runner; downstream tasks may consume via dependsOn. */
  output?: unknown;
  /** Failure detail when status === "failed". */
  error?: string;
  /** How many times this task has been attempted (1 on first run, ≥2 after retry). */
  attempts: number;
};

export type WorkflowDefinition = {
  /** Workflow id (e.g. "daily-research"). */
  readonly id: string;
  /** Human-readable description. */
  readonly name: string;
  /** The runner-visible plan: list of Tasks in dependency order. */
  readonly tasks: readonly Task[];
  /** Workflow-level metadata persisted alongside each run for forensics. */
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type RunStatus = "pending" | "running" | "succeeded" | "failed";

export type Run = {
  readonly id: string;
  readonly workflowId: string;
  readonly createdAt: string;
  startedAt?: string;
  completedAt?: string;
  status: RunStatus;
  /** Snapshot of the workflow's task list with per-task state. */
  tasks: TaskRecord[];
  /** Free-form fields the workflow definition wants to carry through. */
  metadata?: Record<string, unknown>;
};

export type WorkerInput = {
  /** The current task being executed. */
  readonly task: TaskRecord;
  /** Outputs of dependency tasks, keyed by task id. */
  readonly dependencyOutputs: Record<string, unknown>;
  /** Run-level metadata (workflow fingerprint, run id, etc.). */
  readonly run: Pick<Run, "id" | "workflowId" | "metadata">;
  /** Abort signal — workers must check between long operations. */
  readonly signal?: AbortSignal;
};

export type WorkerOutput = {
  /** Whether the worker considers its task complete. */
  readonly ok: boolean;
  /** Free-form result payload; downstream workers consume via dependencyOutputs. */
  readonly result?: unknown;
  /** Failure detail when ok=false. */
  readonly error?: string;
  /** USD cost the worker incurred while running. Optional; LLM-backed
   *  workers report it from the LlmClient's usage data. */
  readonly costUsd?: number;
};

/** A worker is a pure(ish) function that turns a WorkerInput into a WorkerOutput. */
export type Worker = (input: WorkerInput) => Promise<WorkerOutput>;

/** Map of role → worker function. The runner looks up by task.role. */
export type WorkerRegistry = Readonly<Record<WorkerRole, Worker>>;
