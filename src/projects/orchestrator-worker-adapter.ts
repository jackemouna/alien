import type {
  Run as OrchestratorRun,
  TaskRecord as OrchestratorTaskRecord,
  Worker as OrchestratorWorker,
  WorkerRegistry as OrchestratorWorkerRegistry,
} from "../orchestrator/types.js";
import type { ProjectWorker, ProjectWorkerRegistry } from "./pickup-loop.js";
import type { TaskRecord as ProjectTaskRecord } from "./types.js";

/**
 * Bridge from the orchestrator's Worker contract (Run/DAG-shaped) to the
 * project pickup-loop's ProjectWorker contract (Project/board-shaped).
 *
 * The orchestrator's `WorkerInput` shape carries a `run` field with
 * `id`, `workflowId`, `metadata` — fields a planner-emitted task on a
 * Project board does not have. We synthesize a minimal Run façade from
 * the project task so existing orchestrator workers (researcher/writer/
 * editor/publisher) can run unchanged on the new auto-pickup surface.
 *
 * v0.2 will let workers declare their own shape and the adapter goes
 * away. For v0.1 it lets us reuse 200+ lines of tested worker code.
 */

export function adaptOrchestratorWorker(worker: OrchestratorWorker): ProjectWorker {
  return async (input) => {
    const orchestratorTask = toOrchestratorTask(input.task);
    const runFacade: OrchestratorRun = {
      id: `project-${input.project.id}`,
      workflowId: `project-${input.project.id}`,
      createdAt: input.project.createdAt,
      status: "running",
      tasks: [orchestratorTask],
      ...(input.project.metadata ? { metadata: input.project.metadata } : {}),
    };
    const out = await worker({
      task: orchestratorTask,
      dependencyOutputs: input.dependencyOutputs,
      run: {
        id: runFacade.id,
        workflowId: runFacade.workflowId,
        ...(runFacade.metadata ? { metadata: runFacade.metadata } : {}),
      },
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return {
      ok: out.ok,
      ...(out.result !== undefined ? { result: out.result } : {}),
      ...(out.error !== undefined ? { error: out.error } : {}),
    };
  };
}

export function adaptOrchestratorWorkerRegistry(
  registry: OrchestratorWorkerRegistry,
): ProjectWorkerRegistry {
  return {
    researcher: adaptOrchestratorWorker(registry.researcher),
    writer: adaptOrchestratorWorker(registry.writer),
    editor: adaptOrchestratorWorker(registry.editor),
    publisher: adaptOrchestratorWorker(registry.publisher),
  };
}

function toOrchestratorTask(task: ProjectTaskRecord): OrchestratorTaskRecord {
  return {
    id: task.id,
    role: task.role,
    // Project tasks distinguish title + description; the orchestrator's
    // legacy shape has a single summary line. Concatenate when both are
    // distinct so the worker prompt sees the full context.
    summary:
      task.description && task.description !== task.title
        ? `${task.title} — ${task.description}`
        : task.title,
    input: task.input,
    dependsOn: task.dependsOn,
    status: orchestratorStatusForProjectTask(task.status),
    attempts: task.attempts,
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(task.output !== undefined ? { output: task.output } : {}),
    ...(task.error ? { error: task.error } : {}),
  };
}

function orchestratorStatusForProjectTask(
  status: ProjectTaskRecord["status"],
): OrchestratorTaskRecord["status"] {
  switch (status) {
    case "in-progress":
      return "running";
    case "done":
      return "succeeded";
    case "failed":
      return "failed";
    case "review":
      // Orchestrator has no explicit review state; pretend it's still
      // running from the worker's perspective. The pickup loop itself
      // tracks the project-side state.
      return "running";
    case "blocked":
      return "failed";
    case "backlog":
    case "queued":
      return "pending";
  }
}
