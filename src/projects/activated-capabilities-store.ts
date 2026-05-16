import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/**
 * Persistent record of which self-coded capabilities have been activated
 * by the operator. Activation is a one-way step *as far as the loader is
 * concerned* (Phase D2): the file gets copied from the generated sandbox
 * into the active dir; the next gateway boot picks it up. Deactivation
 * (Phase E rollback) reverses both — the active file is removed from the
 * active dir and the record's status flips to "rolled-back".
 *
 * Format: ${state-dir}/activated-capabilities.json
 *
 *   {
 *     "version": 1,
 *     "active": [
 *       {
 *         "id": "stripe",
 *         "integration": "stripe",
 *         "fromRequestId": "cap-...",
 *         "activatedAt": "2026-...",
 *         "activatedBy": "operator",
 *         "sourceDir": "/Users/.../extensions-generated/stripe",
 *         "activeDir": "/Users/.../extensions-active/stripe",
 *         "status": "active" | "rolled-back",
 *         "rollbackAt"?: "2026-..."
 *       },
 *       ...
 *     ]
 *   }
 *
 * Entries are append-only — even after rollback the record stays, with
 * `status: "rolled-back"`, so the reasoning trace ("when was stripe
 * activated? when rolled back? why?") survives.
 */

export type ActivationStatus = "active" | "rolled-back";

export type ActivatedCapabilityRecord = {
  readonly id: string;
  readonly integration: string;
  readonly fromRequestId: string;
  readonly activatedAt: string;
  readonly activatedBy: string;
  readonly sourceDir: string;
  readonly activeDir: string;
  status: ActivationStatus;
  rollbackAt?: string;
  rollbackReason?: string;
};

type ActivatedCapabilitiesFile = {
  readonly version: 1;
  readonly active: ActivatedCapabilityRecord[];
};

const FILE_NAME = "activated-capabilities.json";

export function resolveActivatedCapabilitiesPath(): string {
  return path.join(resolveStateDir(), FILE_NAME);
}

export function resolveActiveExtensionsRoot(): string {
  return path.join(resolveStateDir(), "extensions-active");
}

export async function readActivatedCapabilities(): Promise<ActivatedCapabilityRecord[]> {
  try {
    const raw = await fs.readFile(resolveActivatedCapabilitiesPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { version?: number }).version === 1 &&
      Array.isArray((parsed as { active?: unknown }).active)
    ) {
      return (parsed as ActivatedCapabilitiesFile).active;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return [];
}

export async function writeActivatedCapabilities(
  records: ReadonlyArray<ActivatedCapabilityRecord>,
): Promise<void> {
  const filePath = resolveActivatedCapabilitiesPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const file: ActivatedCapabilitiesFile = { version: 1, active: [...records] };
  await fs.writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

/**
 * Currently-active capabilities (status === "active"). The Phase D2 loader
 * will iterate this list to dynamically load each module.
 */
export async function listLiveCapabilities(): Promise<ActivatedCapabilityRecord[]> {
  const all = await readActivatedCapabilities();
  return all.filter((r) => r.status === "active");
}
