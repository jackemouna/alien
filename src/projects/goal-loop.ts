import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logWarn } from "../logger.js";
import { createAnthropicLlmClient, type LlmClient } from "../orchestrator/llm-client.js";
import { emitProjectsAuditEvent } from "./audit.js";
import { evaluateGoal } from "./goal-evaluator.js";
import { plan, persistPlan } from "./planner.js";
import { listProjectIds, listTasks, loadProject, saveProject } from "./store.js";
import type { GoalEvaluation, Project, TaskRecord } from "./types.js";

/**
 * Phase 2: the goal loop.
 *
 * For each `active` project, periodically:
 *   1. Run the evaluator. Persist the verdict on Project.goalEvaluation.
 *   2. If "achieved" → flip status to "achieved" + audit. Terminal.
 *   3. If "blocked" → flip status to "needs-input" + audit. Terminal until operator unsticks.
 *   4. If "in-progress" AND there's no active work (no queued/in-progress
 *      tasks) → re-fire the planner with priorContext + persist the next
 *      batch. Bump iteration counter.
 *
 * Always opt-in: `ALIEN_GOAL_LOOP=1` enables the background interval.
 * Operator-triggered evaluation (POST /v1/mission/<id>/evaluate) and
 * operator-triggered replan (POST /v1/mission/<id>/replan) work
 * regardless of the env var — those entry points reuse the same helpers.
 */

const DEFAULT_INTERVAL_MS = 5 * 60_000; // 5 min
const MIN_INTERVAL_MS = 30_000;
const DEFAULT_MAX_ITERATIONS = 10;
const EVAL_COOLDOWN_MS = 20_000;

export type GoalLoopOptions = {
  readonly intervalMs?: number;
  readonly llmFactory?: () => Promise<LlmClient>;
};

let activeTimer: NodeJS.Timeout | undefined;
let ticking = false;

export function startGoalLoop(opts: GoalLoopOptions = {}): { stop: () => void } | undefined {
  if (process.env.ALIEN_GOAL_LOOP !== "1") return undefined;
  if (activeTimer) return { stop: stopGoalLoop };
  const interval = Math.max(MIN_INTERVAL_MS, opts.intervalMs ?? DEFAULT_INTERVAL_MS);
  activeTimer = setInterval(() => {
    void tickGoalLoop(opts).catch((err) => {
      logWarn(`goal-loop: tick failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, interval);
  // Don't block process exit on the loop timer.
  if (typeof activeTimer.unref === "function") activeTimer.unref();
  return { stop: stopGoalLoop };
}

export function stopGoalLoop(): void {
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = undefined;
  }
}

/** Public: run one full pass over every active project. Used by the timer. */
export async function tickGoalLoop(opts: GoalLoopOptions = {}): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const projectsDir = resolveProjectsDir();
    const ids = listProjectIds(projectsDir);
    if (ids.length === 0) return;
    let llm: LlmClient | undefined;
    for (const id of ids) {
      const project = loadProject(projectsDir, id);
      if (!project || project.status !== "active") continue;
      const tasks = listTasks(projectsDir, id);
      // Skip if recently evaluated.
      const lastEval = project.goalEvaluation?.evaluatedAt;
      if (lastEval && Date.now() - new Date(lastEval).getTime() < EVAL_COOLDOWN_MS) continue;
      llm ??= await (opts.llmFactory ? opts.llmFactory() : createAnthropicLlmClient({}));
      try {
        await runOneIteration({ project, tasks, llm, projectsDir });
      } catch (err) {
        logWarn(
          `goal-loop: project ${id} iteration failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    ticking = false;
  }
}

/**
 * One iteration: evaluate, persist verdict, take the indicated action.
 * Returns the verdict so callers (HTTP endpoint, tests) can use it.
 */
export async function runOneIteration(args: {
  readonly project: Project;
  readonly tasks: readonly TaskRecord[];
  readonly llm: LlmClient;
  readonly projectsDir: string;
  readonly forceReplan?: boolean;
}): Promise<{ evaluation: GoalEvaluation; action: "achieved" | "blocked" | "replanned" | "idle" }> {
  const { project, tasks, llm, projectsDir } = args;
  const maxIterations = project.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const iterationCount = project.iterationCount ?? 0;
  const evaluation = await evaluateGoal({
    llm,
    project,
    tasks,
    iteration: iterationCount,
  });
  let action: "achieved" | "blocked" | "replanned" | "idle" = "idle";
  let nextStatus = project.status;
  if (evaluation.status === "achieved") {
    nextStatus = "achieved";
    action = "achieved";
    emitAudit("projects.project.goal_achieved", {
      projectId: project.id,
      iteration: iterationCount,
      reason: evaluation.reason,
    });
  } else if (evaluation.status === "blocked") {
    nextStatus = "needs-input";
    action = "blocked";
    emitAudit("projects.project.stuck", {
      projectId: project.id,
      iteration: iterationCount,
      reason: evaluation.reason,
    });
  } else if (iterationCount >= maxIterations) {
    nextStatus = "needs-input";
    action = "blocked";
    emitAudit("projects.project.stuck", {
      projectId: project.id,
      iteration: iterationCount,
      reason: `Iteration cap (${maxIterations}) reached without convergence.`,
    });
  } else if (shouldReplan(tasks) || args.forceReplan) {
    try {
      const planResult = await plan(
        {
          projectId: project.id,
          prompt: project.goal,
          origin: { kind: "planner", runId: `goal-loop-${iterationCount + 1}` },
          existing: tasks,
        },
        { llm },
      );
      if (planResult.tasks.length > 0) {
        persistPlan(project.id, planResult, {
          projectsDir,
          origin: { kind: "planner", runId: `goal-loop-${iterationCount + 1}` },
        });
        action = "replanned";
        emitAudit("projects.project.iteration_started", {
          projectId: project.id,
          iteration: iterationCount + 1,
          tasksEmitted: planResult.tasks.length,
        });
      }
    } catch (err) {
      logWarn(
        `goal-loop: replan failed for ${project.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const updated: Project = {
    ...project,
    status: nextStatus,
    goalEvaluation: evaluation,
    iterationCount: iterationCount + 1,
  };
  saveProject(projectsDir, updated);
  return { evaluation, action };
}

function shouldReplan(tasks: readonly TaskRecord[]): boolean {
  if (tasks.length === 0) return true;
  return !tasks.some(
    (t) => t.status === "queued" || t.status === "in-progress" || t.status === "review",
  );
}

function emitAudit(
  kind:
    | "projects.project.goal_achieved"
    | "projects.project.stuck"
    | "projects.project.iteration_started",
  payload: Record<string, unknown>,
): void {
  const auditLogPath = resolveAuditLogPath();
  if (!auditLogPath) return;
  emitProjectsAuditEvent({ kind, payload }, { auditLogPath });
}

function resolveProjectsDir(): string {
  return path.join(resolveStateDir(process.env), "projects");
}

function resolveAuditLogPath(): string | undefined {
  if (process.env.ALIEN_DISABLE_AUDIT_LOG === "1") return undefined;
  return path.join(resolveStateDir(process.env), "audit.log");
}
