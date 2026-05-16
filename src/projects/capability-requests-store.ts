import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/**
 * Persistent log of capability requests the planner has raised. One JSON
 * file at `${state-dir}/capability-requests.json` accumulates every
 * "we need integration X" event so the operator can review them in one
 * place and (in Phase C) the self-coding worker can pick them up.
 *
 * Each entry is append-only — disconnection / completion is tracked by a
 * status field, not by removing entries (so the audit trail stays
 * complete).
 */

export type CapabilityRequestStatus = "open" | "in-progress" | "fulfilled" | "rejected";

export type CapabilityRequest = {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly integration: string;
  readonly why: string;
  readonly sketch?: string;
  readonly createdAt: string;
  status: CapabilityRequestStatus;
  /** Operator note: why fulfilled / rejected, or what Phase-C agent was assigned. */
  resolution?: string;
};

type CapabilityRequestsFile = {
  readonly version: 1;
  readonly requests: CapabilityRequest[];
};

const FILE_NAME = "capability-requests.json";

export function resolveCapabilityRequestsPath(): string {
  return path.join(resolveStateDir(), FILE_NAME);
}

export async function readCapabilityRequests(): Promise<CapabilityRequest[]> {
  try {
    const raw = await fs.readFile(resolveCapabilityRequestsPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { version?: number }).version === 1 &&
      Array.isArray((parsed as { requests?: unknown }).requests)
    ) {
      return (parsed as CapabilityRequestsFile).requests;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return [];
}

export async function appendCapabilityRequest(req: CapabilityRequest): Promise<void> {
  const existing = await readCapabilityRequests();
  existing.push(req);
  const filePath = resolveCapabilityRequestsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const file: CapabilityRequestsFile = { version: 1, requests: existing };
  await fs.writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600).catch(() => {});
}
