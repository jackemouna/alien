import type { AlienConfig } from "../config/types.alien.js";
import { logWarn } from "../logger.js";
import {
  startProjectsRuntime,
  type ProjectsRuntimeHandle,
  type ProjectsRuntimeOptions,
} from "./projects-runtime.js";

/**
 * Process-wide singleton that starts the Projects runtime (pickup loop +
 * channel-inbox listener) at most once. Two entry points use it:
 *
 *   - The HTTP route layer (projects-http.ts) calls
 *     `ensureProjectsRuntimeStarted(cfg)` on first request, so users get
 *     auto-pickup the moment they touch the Projects tab even when the
 *     gateway boot path has not been updated to start it eagerly.
 *
 *   - The gateway boot path (server.impl.ts) may call the same function
 *     proactively so inbound Slack DMs are processed even when no one
 *     has opened the Projects tab in this gateway lifetime.
 *
 * The singleton handle is held in a module-local variable. Process-exit
 * cleanup is best-effort via `beforeExit`; tests can reset via
 * `resetProjectsRuntimeSingletonForTest()`.
 */

let handle: ProjectsRuntimeHandle | null = null;
let starting: Promise<ProjectsRuntimeHandle> | null = null;
let beforeExitRegistered = false;

export async function ensureProjectsRuntimeStarted(
  opts: ProjectsRuntimeOptions,
): Promise<ProjectsRuntimeHandle> {
  if (handle) return handle;
  if (starting) return starting;
  starting = startProjectsRuntime(opts)
    .then((h) => {
      handle = h;
      registerBeforeExitOnce();
      return h;
    })
    .catch((err) => {
      logWarn(`projects-runtime-singleton: start failed: ${stringifyError(err)}`);
      throw err;
    })
    .finally(() => {
      starting = null;
    });
  return starting;
}

export function getProjectsRuntimeHandle(): ProjectsRuntimeHandle | null {
  return handle;
}

export function resetProjectsRuntimeSingletonForTest(): void {
  if (handle) {
    handle.stop();
  }
  handle = null;
  starting = null;
}

function registerBeforeExitOnce(): void {
  if (beforeExitRegistered) return;
  beforeExitRegistered = true;
  process.once("beforeExit", () => {
    if (handle) {
      handle.stop();
      handle = null;
    }
  });
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Re-export for callers that already need the AlienConfig type when passing
// opts through their own factory.
export type { AlienConfig };
