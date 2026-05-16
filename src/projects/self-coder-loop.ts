import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logWarn } from "../logger.js";
import { emitProjectsAuditEvent } from "./audit.js";
import { readCapabilityRequests, type CapabilityRequest } from "./capability-requests-store.js";
import { listProjectIds, listTasks, loadProject, saveTask } from "./store.js";
import { createTaskRecord } from "./task-state.js";
import type { TaskDraft } from "./types.js";

/**
 * Phase 3: the self-coder loop.
 *
 * For each open capability request, find the owning project and create a
 * `self-coder` task (one per request, requires approval) so the workforce
 * pickup loop can build the missing capability. Idempotent: skips
 * requests that already have a self-coder task on the project.
 *
 * Off by default. Opt-in via `ALIEN_SELF_CODER=1`.
 *
 * The created task carries:
 *   - role: "self-coder"           (pickup-loop dispatches to the worker)
 *   - expertId: "engineering-self-coder"  (Mission Control routes the card)
 *   - input: { requestId }
 *   - requiresApproval: true       (operator must approve before pickup —
 *     hard safety on a model-writes-code path)
 *   - priority: "high"
 */

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 10_000;
const SELF_CODER_EXPERT_ID = "engineering-self-coder";

export type SelfCoderLoopOptions = {
  readonly intervalMs?: number;
};

let activeTimer: NodeJS.Timeout | undefined;
let ticking = false;

export function startSelfCoderLoop(
  opts: SelfCoderLoopOptions = {},
): { stop: () => void } | undefined {
  if (process.env.ALIEN_SELF_CODER !== "1") return undefined;
  if (activeTimer) return { stop: stopSelfCoderLoop };
  const interval = Math.max(MIN_INTERVAL_MS, opts.intervalMs ?? DEFAULT_INTERVAL_MS);
  activeTimer = setInterval(() => {
    void tickSelfCoderLoop().catch((err) => {
      logWarn(`self-coder-loop: tick failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, interval);
  if (typeof activeTimer.unref === "function") activeTimer.unref();
  return { stop: stopSelfCoderLoop };
}

export function stopSelfCoderLoop(): void {
  if (activeTimer) {
    clearInterval(activeTimer);
    activeTimer = undefined;
  }
}

/** Public: one full pass. Called by the timer and by tests. */
export async function tickSelfCoderLoop(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const requests = await readCapabilityRequests();
    const open = requests.filter((r) => r.status === "open");
    if (open.length === 0) return;
    const projectsDir = resolveProjectsDir();
    for (const req of open) {
      try {
        await maybeCreateSelfCoderTask(req, projectsDir);
      } catch (err) {
        logWarn(
          `self-coder-loop: request ${req.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    ticking = false;
  }
}

async function maybeCreateSelfCoderTask(
  request: CapabilityRequest,
  projectsDir: string,
): Promise<void> {
  const project = loadProject(projectsDir, request.projectId);
  if (!project) return;
  const tasks = listTasks(projectsDir, request.projectId);
  const alreadyHasOne = tasks.some(
    (t) =>
      t.role === "self-coder" &&
      typeof (t.input as { requestId?: unknown }).requestId === "string" &&
      (t.input as { requestId: string }).requestId === request.id,
  );
  if (alreadyHasOne) return;

  const draft: TaskDraft = {
    title: `Self-code: ${request.integration}`,
    description: `Generate a brand-new capability for the integration "${request.integration}". Reason: ${request.why}.`,
    role: "self-coder",
    dependsOn: [],
    input: { requestId: request.id },
    priority: "high",
    requiresApproval: true,
    expertId: SELF_CODER_EXPERT_ID,
  };
  const taskId = `task-sc-${request.id.replace(/^cap-/, "")}`;
  const record = createTaskRecord({
    taskId,
    projectId: project.id,
    draft,
    origin: { kind: "planner", runId: `self-coder-loop` },
  });
  saveTask(projectsDir, record);

  const auditLogPath = resolveAuditLogPath();
  if (auditLogPath) {
    emitProjectsAuditEvent(
      {
        kind: "projects.task.created",
        payload: {
          projectId: project.id,
          taskId: record.id,
          role: record.role,
          expertId: SELF_CODER_EXPERT_ID,
          requestId: request.id,
          integration: request.integration,
          origin: { kind: "self-coder-loop" },
        },
      },
      { auditLogPath },
    );
  }
}

/** Listed only for the future when callers want a UI summary. */
export async function listOpenCapabilityRequests(): Promise<readonly CapabilityRequest[]> {
  const all = await readCapabilityRequests();
  return all.filter((r) => r.status === "open" || r.status === "in-progress");
}

/** For tests / UIs: filter to the open + in-progress requests on one project. */
export async function listProjectCapabilityRequests(
  projectId: string,
): Promise<readonly CapabilityRequest[]> {
  const all = await readCapabilityRequests();
  return all.filter((r) => r.projectId === projectId);
}

function resolveProjectsDir(): string {
  return path.join(resolveStateDir(process.env), "projects");
}

function resolveAuditLogPath(): string | undefined {
  if (process.env.ALIEN_DISABLE_AUDIT_LOG === "1") return undefined;
  return path.join(resolveStateDir(process.env), "audit.log");
}

// Suppress unused-import warning — listProjectIds is here for the symmetric
// API used by a future "scan-all-projects" helper.
void listProjectIds;
