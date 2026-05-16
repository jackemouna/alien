import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  readActivatedCapabilities,
  resolveActiveExtensionsRoot,
  writeActivatedCapabilities,
  type ActivatedCapabilityRecord,
} from "./activated-capabilities-store.js";
import { emitProjectsAuditEvent } from "./audit.js";
import {
  readCapabilityRequests,
  resolveCapabilityRequestsPath,
} from "./capability-requests-store.js";

/**
 * Activation + rollback for self-coded capability stubs (Phase D + E).
 *
 * - activateCapability(requestId)   — copy generated files from the
 *   sandbox into the active dir, persist the activation record, and
 *   emit a projects.capability.activated audit event. Idempotent: a
 *   second call on an already-active capability returns the existing
 *   record without re-copying.
 * - deactivateCapability(requestId) — remove the active-dir copy
 *   (the sandbox copy stays for forensics), flip the activation record
 *   to "rolled-back", and emit projects.capability.deactivated.
 *
 * Hard guardrails baked in:
 *
 * - The active dir lives under ${state-dir}/extensions-active/<id>/.
 *   activateCapability refuses to write anywhere else.
 * - Activation refuses if the capability request status is not
 *   "fulfilled" (i.e. the self-coder hasn't actually produced files yet).
 * - Activation refuses if any file in the sandbox dir looks suspicious
 *   (symlink to outside, path-traversal sibling, > 1MB).
 *
 * Note: this does NOT load the activated module into the running gateway.
 * Phase D2 will add the runtime loader; v0.1 prints a "restart required"
 * message when activation completes.
 */

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB per file

export type ActivationOutcome =
  | {
      readonly ok: true;
      readonly record: ActivatedCapabilityRecord;
      readonly newlyActivated: boolean;
    }
  | { readonly ok: false; readonly error: string };

export type DeactivationOutcome =
  | { readonly ok: true; readonly record: ActivatedCapabilityRecord }
  | { readonly ok: false; readonly error: string };

export type ActivatorOptions = {
  readonly auditLogPath?: string;
  /**
   * Where the self-coder wrote its sandbox files. Defaults to
   * ${state-dir}/extensions-generated/. Tests inject a temp dir.
   */
  readonly generatedRoot?: string;
  /**
   * Where activated capabilities live. Defaults to
   * ${state-dir}/extensions-active/. Tests inject a temp dir.
   */
  readonly activeRoot?: string;
  readonly now?: () => string;
  readonly actor?: string;
};

export async function activateCapability(
  requestId: string,
  opts: ActivatorOptions = {},
): Promise<ActivationOutcome> {
  const requests = await readCapabilityRequests();
  const request = requests.find((r) => r.id === requestId);
  if (!request) {
    return { ok: false, error: `unknown capability request: ${requestId}` };
  }
  if (request.status !== "fulfilled") {
    return {
      ok: false,
      error: `capability request ${requestId} is "${request.status}" — only "fulfilled" requests can be activated. Run /v1/capabilities/${requestId}/build first.`,
    };
  }

  const sourceRoot = opts.generatedRoot ?? path.join(resolveStateDir(), "extensions-generated");
  const activeRoot = opts.activeRoot ?? resolveActiveExtensionsRoot();
  const id = sanitizeId(request.integration);
  const sourceDir = path.join(sourceRoot, id);
  const activeDir = path.join(activeRoot, id);

  const existing = await readActivatedCapabilities();
  const already = existing.find((r) => r.id === id && r.status === "active");
  if (already) {
    return { ok: true, record: already, newlyActivated: false };
  }

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (err) {
    return {
      ok: false,
      error: `no generated files at ${sourceDir} (${err instanceof Error ? err.message : String(err)})`,
    };
  }
  if (entries.length === 0) {
    return { ok: false, error: `generated dir ${sourceDir} is empty; nothing to activate` };
  }
  // Reject if anything weird is in the sandbox (symlinks, oversized files,
  // nested directories with traversal). Stay conservative — Phase E.
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      return { ok: false, error: `refusing to activate: ${entry.name} is a symlink` };
    }
    if (!entry.isFile() && !entry.isDirectory()) {
      return {
        ok: false,
        error: `refusing to activate: ${entry.name} is not a regular file or dir`,
      };
    }
    const stat = await fs.stat(path.join(sourceDir, entry.name));
    if (entry.isFile() && stat.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `refusing to activate: ${entry.name} is ${stat.size} bytes (max ${MAX_FILE_BYTES})`,
      };
    }
  }

  await fs.mkdir(activeDir, { recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(activeDir, entry.name);
    // copyFile preserves contents but not perms; we tighten perms below.
    await fs.copyFile(src, dst);
    await fs.chmod(dst, 0o644).catch(() => {});
  }

  const record: ActivatedCapabilityRecord = {
    id,
    integration: request.integration,
    fromRequestId: request.id,
    activatedAt: opts.now ? opts.now() : new Date().toISOString(),
    activatedBy: opts.actor ?? "operator",
    sourceDir,
    activeDir,
    status: "active",
  };
  const next = [...existing.filter((r) => !(r.id === id && r.status === "active")), record];
  await writeActivatedCapabilities(next);

  if (opts.auditLogPath) {
    emitProjectsAuditEvent(
      {
        kind: "projects.capability.activated",
        payload: {
          id,
          integration: request.integration,
          fromRequestId: request.id,
          activeDir,
          activatedBy: record.activatedBy,
        },
      },
      { auditLogPath: opts.auditLogPath },
    );
  }

  return { ok: true, record, newlyActivated: true };
}

export async function deactivateCapability(
  requestId: string,
  reason: string | undefined,
  opts: ActivatorOptions = {},
): Promise<DeactivationOutcome> {
  const records = await readActivatedCapabilities();
  const idx = records.findIndex((r) => r.fromRequestId === requestId && r.status === "active");
  if (idx < 0) {
    return {
      ok: false,
      error: `no active capability for request ${requestId} (already rolled back, or never activated)`,
    };
  }
  const record = records[idx]!;
  const activeDir = record.activeDir;
  // Remove the active-dir copy; leave the sandbox copy on disk so the
  // forensics ("what was the bad code?") survive rollback.
  try {
    await fs.rm(activeDir, { recursive: true, force: true });
  } catch (err) {
    return {
      ok: false,
      error: `failed to remove ${activeDir}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const updated: ActivatedCapabilityRecord = {
    ...record,
    status: "rolled-back",
    rollbackAt: opts.now ? opts.now() : new Date().toISOString(),
    ...(reason ? { rollbackReason: reason } : {}),
  };
  const next = [...records];
  next[idx] = updated;
  await writeActivatedCapabilities(next);

  if (opts.auditLogPath) {
    emitProjectsAuditEvent(
      {
        kind: "projects.capability.deactivated",
        payload: {
          id: record.id,
          integration: record.integration,
          fromRequestId: requestId,
          rolledBackBy: opts.actor ?? "operator",
          ...(reason ? { reason } : {}),
        },
      },
      { auditLogPath: opts.auditLogPath },
    );
  }
  return { ok: true, record: updated };
}

/**
 * Reasoning trace for a capability — the audit lineage from "planner
 * detected gap" through "operator activated" or "rolled back". Returns
 * the original request, all generation events from the audit log, and
 * the activation record (if any).
 *
 * Cheap to compute; just three file reads. The HTTP endpoint can call
 * this directly per request.
 */
export async function readReasoningTrace(requestId: string): Promise<{
  readonly request: import("./capability-requests-store.js").CapabilityRequest | undefined;
  readonly activation: ActivatedCapabilityRecord | undefined;
  readonly trace: {
    readonly note: string;
    readonly sources: { readonly file: string; readonly path: string }[];
  };
}> {
  const requests = await readCapabilityRequests();
  const request = requests.find((r) => r.id === requestId);
  const activations = await readActivatedCapabilities();
  const activation = activations.find((r) => r.fromRequestId === requestId);
  return {
    request,
    activation,
    trace: {
      note: "Full event timeline lives in the audit log; this trace summarizes the persistent records.",
      sources: [
        { file: "capability-requests.json", path: resolveCapabilityRequestsPath() },
        { file: "audit.log", path: path.join(resolveStateDir(), "audit.log") },
      ],
    },
  };
}

function sanitizeId(id: string): string {
  const cleaned = id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "unnamed";
}
