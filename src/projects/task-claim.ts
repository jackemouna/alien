import path from "node:path";
import type { WorkerRole } from "../orchestrator/types.js";
import { withFileLock, type FileLockOptions } from "../plugin-sdk/file-lock.js";
import {
  listTasks,
  resolveProjectDir,
  resolveTaskFile,
  saveTask,
  type ProjectStoreOptions,
} from "./store.js";
import { findEligibleTask, markTaskClaimed } from "./task-state.js";
import type { TaskRecord } from "./types.js";

/**
 * Race-safe task claiming. Multiple worker processes (or in-process workers
 * within the auto-pickup loop) can compete to claim the next eligible task
 * for a role. The `withFileLock` helper serializes scan-and-mutate under a
 * per-project lock so two workers never claim the same task.
 *
 * The lock file lives at `<projectsDir>/<projectId>/.tasks.lock`, separate
 * from the task JSON files themselves so the lock fingerprint is independent
 * of any single task's content.
 */

const DEFAULT_LOCK_OPTIONS: FileLockOptions = {
  retries: { retries: 8, factor: 2, minTimeout: 25, maxTimeout: 500, randomize: true },
  stale: 5_000,
};

export type ClaimTaskOptions = {
  readonly projectsDir: string;
  readonly projectId: string;
  readonly role: WorkerRole;
  readonly claimedBy: string;
  readonly storeOptions?: ProjectStoreOptions;
  readonly lockOptions?: FileLockOptions;
  readonly now?: () => string;
};

export type ClaimTaskResult =
  | { readonly ok: true; readonly task: TaskRecord }
  | { readonly ok: false; readonly reason: "no-eligible-task" | "project-missing" };

export async function claimTask(opts: ClaimTaskOptions): Promise<ClaimTaskResult> {
  const lockPath = resolveLockPath(opts.projectsDir, opts.projectId);
  const lockOptions = opts.lockOptions ?? DEFAULT_LOCK_OPTIONS;
  return await withFileLock(lockPath, lockOptions, async () => {
    const tasks = listTasks(opts.projectsDir, opts.projectId, opts.storeOptions);
    if (tasks.length === 0) {
      return { ok: false, reason: "no-eligible-task" } as const;
    }
    const eligible = findEligibleTask(tasks, opts.role);
    if (!eligible) {
      return { ok: false, reason: "no-eligible-task" } as const;
    }
    const claimed = markTaskClaimed(eligible, opts.claimedBy, opts.now);
    saveTask(opts.projectsDir, claimed, opts.storeOptions);
    return { ok: true, task: claimed } as const;
  });
}

export function resolveLockPath(projectsDir: string, projectId: string): string {
  return path.join(resolveProjectDir(projectsDir, projectId), ".tasks.lock");
}

// Helps the callers locate the task file after a successful claim without
// having to import the store directly when they only need the path.
export { resolveTaskFile };
