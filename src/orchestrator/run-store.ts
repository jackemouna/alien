import fs from "node:fs";
import path from "node:path";
import type { Run } from "./types.js";

/**
 * Disk persistence for orchestrator runs. Each run is one JSON file at
 * `<orchestratorDir>/runs/<runId>.json` with mode 0o600. The format is the
 * full Run object as written by the runner; loading is a single fs.readFile
 * + JSON.parse with a minimal shape check.
 *
 * The orchestrator deliberately does not share the audit-log infrastructure
 * here — Run state is the runner's working memory and changes on every
 * task transition. The audit log is for security-relevant events (which the
 * runner emits separately via existing audit-log helpers).
 */

export type RunStoreOptions = {
  /** Override hook for fs (testability). */
  readonly fsImpl?: Pick<
    typeof fs,
    "readFileSync" | "writeFileSync" | "mkdirSync" | "existsSync" | "readdirSync" | "rmSync"
  >;
};

export function resolveRunPath(orchestratorDir: string, runId: string): string {
  return path.join(orchestratorDir, "runs", `${sanitizeRunId(runId)}.json`);
}

export function saveRun(orchestratorDir: string, run: Run, options: RunStoreOptions = {}): void {
  const fsImpl = options.fsImpl ?? fs;
  const filePath = resolveRunPath(orchestratorDir, run.id);
  const dir = path.dirname(filePath);
  if (!fsImpl.existsSync(dir)) {
    fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fsImpl.writeFileSync(filePath, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
}

export function loadRun(
  orchestratorDir: string,
  runId: string,
  options: RunStoreOptions = {},
): Run | null {
  const fsImpl = options.fsImpl ?? fs;
  const filePath = resolveRunPath(orchestratorDir, runId);
  if (!fsImpl.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fsImpl.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Run;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tasks)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function listRunIds(orchestratorDir: string, options: RunStoreOptions = {}): string[] {
  const fsImpl = options.fsImpl ?? fs;
  const runsDir = path.join(orchestratorDir, "runs");
  if (!fsImpl.existsSync(runsDir)) {
    return [];
  }
  const entries = fsImpl.readdirSync(runsDir);
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .toSorted();
}

export function deleteRun(
  orchestratorDir: string,
  runId: string,
  options: RunStoreOptions = {},
): boolean {
  const fsImpl = options.fsImpl ?? fs;
  const filePath = resolveRunPath(orchestratorDir, runId);
  if (!fsImpl.existsSync(filePath)) {
    return false;
  }
  fsImpl.rmSync(filePath, { force: true });
  return true;
}

function sanitizeRunId(runId: string): string {
  // Run ids end up as filenames. Refuse anything that could escape the runs/
  // directory or contain shell metacharacters.
  if (!/^[A-Za-z0-9_.-]+$/.test(runId)) {
    throw new Error(`Invalid run id (must match [A-Za-z0-9_.-]+): ${runId}`);
  }
  if (runId.startsWith(".") || runId === "..") {
    throw new Error(`Invalid run id (refusing dotfile/parent): ${runId}`);
  }
  return runId;
}
