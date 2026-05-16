import {
  buildDefaultCapabilityDeps,
  type CapabilityRuntimeLoader,
} from "./capability-runtime-loader.js";
import type { ProjectWorker, ProjectWorkerOutput } from "./pickup-loop.js";

/**
 * Generic dispatcher for activated capabilities (Phase D2). The planner
 * emits a task with role: "capability-runner" and input shape:
 *
 *   { "capability": "<id>", "args": { ... } }
 *
 * This worker looks the capability up in the runtime loader and invokes
 * the loaded module's `run(args, deps)`. If the capability isn't loaded
 * (never activated, deactivated, or the gateway restarted before the
 * loader picked it up), the worker returns a friendly error so the
 * goal-loop's evaluator can react ("looks like that capability isn't
 * active yet — ask the operator").
 */

export function createCapabilityRunnerWorker(loader: CapabilityRuntimeLoader): ProjectWorker {
  return async ({ task }): Promise<ProjectWorkerOutput> => {
    const input = task.input as { capability?: unknown; args?: unknown };
    const capabilityId = typeof input.capability === "string" ? input.capability.trim() : "";
    if (!capabilityId) {
      return {
        ok: false,
        error: "capability-runner requires { capability: string } in task.input",
      };
    }
    const args =
      input.args && typeof input.args === "object" ? (input.args as Record<string, unknown>) : {};
    const loaded = loader.getCapability(capabilityId);
    if (!loaded) {
      return {
        ok: false,
        error: `capability "${capabilityId}" is not loaded. Either it was never activated (see /v1/capabilities), it was deactivated, or activation persisted but the gateway hasn't picked it up yet.`,
      };
    }
    try {
      const result = await loaded.run(args, buildDefaultCapabilityDeps());
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: `capability "${capabilityId}" threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  };
}
