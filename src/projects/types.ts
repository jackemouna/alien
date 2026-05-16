/**
 * Projects + Tasks domain model — a long-running, persistent workspace where
 * the planner agent deposits Tasks and specialist workers auto-pick them up.
 *
 * The orchestrator's Run/TaskRecord types in src/orchestrator/types.ts model
 * a deterministic DAG created upfront and consumed to completion. Projects
 * are the superset: a Project is *open-ended*, tasks accrue over time from
 * channels and the planner, workers claim them race-safely.
 *
 * A Run becomes a derived slice of a Project's tasks — the planner emits
 * a batch with a shared run id; the runner observes the batch through the
 * same task store. Existing orchestrator code is unchanged.
 */

import type { WorkerRole } from "../orchestrator/types.js";

/**
 * Project lifecycle. Goal-loop additions:
 *   - "achieved" — the evaluator confirmed the goal is met. Terminal.
 *   - "needs-input" — the evaluator gave up (hit iteration cap or stuck).
 *     Operator action required before the loop can resume.
 */
export type ProjectStatus = "active" | "paused" | "archived" | "achieved" | "needs-input";

/**
 * Task lifecycle. A few important transitions:
 *   - "queued" is the state an auto-pickup-eligible task lives in.
 *   - "review" is set when a worker completes a task that requires human
 *     sign-off before the dependent tasks become runnable.
 *   - "blocked" is set when an upstream dependency failed; the runner does
 *     not auto-retry, the human resolves.
 */
export type TaskStatus =
  | "backlog"
  | "queued"
  | "in-progress"
  | "review"
  | "done"
  | "blocked"
  | "failed";

export type Priority = "low" | "normal" | "high" | "urgent";

/**
 * Where the task came from. Lets the runner reply in the same channel that
 * created the work, and lets the audit log answer "who asked for this?"
 */
export type TaskOrigin =
  | { kind: "operator" }
  | { kind: "planner"; runId: string }
  | {
      kind: "channel";
      channel: string;
      accountId?: string;
      threadId?: string;
      authorDisplayName?: string;
    };

export type TaskRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly role: WorkerRole;
  /** Other task ids in the same project that must reach "done" first. */
  readonly dependsOn: readonly string[];
  /** Worker-specific input payload. Workers consume verbatim. */
  readonly input: Record<string, unknown>;
  readonly origin: TaskOrigin;
  readonly priority: Priority;
  readonly createdAt: string;

  status: TaskStatus;
  /** Set when a worker holds the task. Empty when not claimed. */
  claimedBy?: string;
  claimedAt?: string;
  startedAt?: string;
  completedAt?: string;
  attempts: number;
  output?: unknown;
  error?: string;
  /**
   * USD cost the worker reported after running. Written by the pickup
   * loop from `WorkerOutput.costUsd` when the worker reports it.
   * Workers that don't call an LLM (e.g. publisher) leave this unset.
   */
  costUsd?: number;
  /**
   * If true, the planner has marked this task as needing operator approval
   * before its dependents may proceed. The runner pauses on "review" status.
   */
  requiresApproval?: boolean;
};

/**
 * A persistent workspace tied to one user goal. Channels attached here are
 * inboxes — inbound DMs become Tasks; worker output replies in-thread.
 */
export type ProjectChannelBinding = {
  /** Channel id ("slack", "discord", "telegram", "gmail", …). */
  readonly channel: string;
  /** Per-channel account or workspace identifier. */
  readonly accountId?: string;
  /** Optional default thread/conversation to post unattributed updates into. */
  readonly defaultThreadId?: string;
};

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly goal: string;
  readonly owner: string;
  readonly createdAt: string;
  status: ProjectStatus;
  /** Channels attached to this project as inbox + reply-back surfaces. */
  channels: ProjectChannelBinding[];
  /**
   * Expert ids (from src/experts/registry.ts) assigned to this mission.
   * Phase 1 ships with all bundled experts assigned by default; the
   * planner uses this list to route each Task to the best-fit expert.
   * Optional for backward compatibility with pre-Phase-1 project files.
   */
  assignedExperts?: string[];
  /** Free-form metadata the planner or operator wants to carry through. */
  metadata?: Record<string, unknown>;
};

/**
 * Convenience: a project plus the set of tasks currently associated with it.
 * Persistence stores them separately so a single task transition does not
 * rewrite the whole project file.
 */
export type ProjectSnapshot = {
  readonly project: Project;
  readonly tasks: readonly TaskRecord[];
};

/**
 * Inputs the planner agent receives. The planner's job is to turn this into
 * an array of Tasks (with internal dependencies) that the workers will
 * auto-pickup.
 */
export type PlanRequest = {
  readonly projectId: string;
  readonly prompt: string;
  readonly origin: TaskOrigin;
  /** Existing tasks already on the project board, so the planner doesn't duplicate. */
  readonly existing: readonly TaskRecord[];
  /**
   * Set when the goal-loop is re-firing the planner after an evaluation
   * round. Includes the goal recap, prior task outcomes summary, and the
   * evaluator's feedback on what's still missing. The planner uses this
   * to pivot rather than re-emit the same DAG.
   */
  readonly priorContext?: PlannerPriorContext;
};

export type PlannerPriorContext = {
  /** Iteration index, 1-based. Iteration 1 is the second planner call. */
  readonly iteration: number;
  /** Recap of the project goal the loop is pursuing. */
  readonly goal: string;
  /**
   * Evaluator's "why we're still not done" message. The planner should
   * treat this as the new top-level instruction, more important than the
   * raw user prompt for this round.
   */
  readonly evaluatorFeedback: string;
  /**
   * Short prose summary of what prior task batches produced. Truncated
   * if the underlying outputs are huge. The planner uses this to decide
   * what's new vs already-done.
   */
  readonly priorResultsSummary: string;
};

export type PlanResult = {
  /** Ready-to-persist task drafts. `id` is filled in by the caller. */
  readonly tasks: readonly TaskDraft[];
  /** Optional short summary the planner returns to the human in-channel. */
  readonly summary?: string;
};

export type TaskDraft = {
  readonly title: string;
  readonly description: string;
  readonly role: WorkerRole;
  readonly dependsOn: readonly string[];
  readonly input: Record<string, unknown>;
  readonly priority?: Priority;
  readonly requiresApproval?: boolean;
};
