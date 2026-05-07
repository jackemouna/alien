import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Audit M4: tamper-evident JSONL log for security-relevant events.
 *
 * Each line is `{ ts, kind, payload, prevHash, hash }` where:
 *   - `ts` is an ISO-8601 timestamp.
 *   - `kind` is a short event identifier (e.g. "cron.add", "self_edit.refused").
 *   - `payload` is an arbitrary JSON-serializable object describing the event.
 *   - `prevHash` is the `hash` field of the previous line (or "" for the first).
 *   - `hash` is sha256(prevHash + canonicalJson({ ts, kind, payload, prevHash })).
 *
 * The chain links each entry to its predecessor. Tampering with any line
 * (changing/inserting/deleting) breaks the chain at every later entry, which
 * `verifyAuditLog` detects.
 *
 * The file is append-only from the code's perspective: `appendAuditLog`
 * never rewrites earlier lines. Concurrent appenders may interleave; the
 * caller is responsible for serialization in code paths where ordering
 * matters (most call sites are single-process).
 */

export type AuditEntryKind =
  | "cron.add"
  | "cron.update"
  | "cron.remove"
  | "cron.run"
  | "cron.wake"
  | "cron.refused"
  | "self_edit.allowed"
  | "self_edit.refused"
  | "pairing.rate_limited"
  | "gateway.token_inline_refused"
  | "fs_write.blocked"
  | "exec.dangerous";

export type AuditEntry = {
  ts: string;
  kind: AuditEntryKind | (string & {});
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
};

export type AppendAuditLogOptions = {
  /** Where the JSONL file lives. Caller resolves; helper does not assume `~/.alien`. */
  readonly logPath: string;
  /** Override hook for the current time (default Date.now). */
  readonly now?: () => number;
  /** Override hook for `fs` (default node:fs). */
  readonly fsImpl?: Pick<typeof fs, "readFileSync" | "appendFileSync" | "mkdirSync" | "existsSync">;
};

/**
 * Appends one event to the audit log, preserving the hash chain. Creates the
 * parent directory if missing. Returns the entry that was written.
 */
export function appendAuditLog(
  event: { kind: string; payload: Record<string, unknown> },
  options: AppendAuditLogOptions,
): AuditEntry {
  const fsImpl = options.fsImpl ?? fs;
  const now = options.now ?? Date.now;
  const dir = path.dirname(options.logPath);
  if (!fsImpl.existsSync(dir)) {
    fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const prevHash = readLastHash(options.logPath, fsImpl);
  const ts = new Date(now()).toISOString();
  const headless = { ts, kind: event.kind, payload: event.payload, prevHash };
  const hash = createHash("sha256").update(prevHash).update(canonicalJson(headless)).digest("hex");
  const entry: AuditEntry = { ...headless, hash };
  fsImpl.appendFileSync(options.logPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}

/**
 * Reads the audit log and verifies every entry's hash links to its
 * predecessor. Returns:
 *   - `{ ok: true, count }` if the chain is intact.
 *   - `{ ok: false, breakIndex, reason }` for the first broken entry.
 */
export function verifyAuditLog(
  logPath: string,
  fsImpl: Pick<typeof fs, "readFileSync" | "existsSync"> = fs,
): { ok: true; count: number } | { ok: false; breakIndex: number; reason: string } {
  if (!fsImpl.existsSync(logPath)) {
    return { ok: true, count: 0 };
  }
  const raw = fsImpl.readFileSync(logPath, "utf8");
  const lines = raw.split("\n").filter((line) => line.length > 0);

  let prevHash = "";
  for (let i = 0; i < lines.length; i += 1) {
    let entry: AuditEntry;
    try {
      entry = JSON.parse(lines[i]) as AuditEntry;
    } catch {
      return { ok: false, breakIndex: i, reason: "line is not valid JSON" };
    }
    if (entry.prevHash !== prevHash) {
      return {
        ok: false,
        breakIndex: i,
        reason: `prevHash mismatch (expected ${prevHash || "<empty>"}, found ${entry.prevHash || "<empty>"})`,
      };
    }
    const headless = {
      ts: entry.ts,
      kind: entry.kind,
      payload: entry.payload,
      prevHash: entry.prevHash,
    };
    const expected = createHash("sha256")
      .update(prevHash)
      .update(canonicalJson(headless))
      .digest("hex");
    if (expected !== entry.hash) {
      return {
        ok: false,
        breakIndex: i,
        reason: "hash does not match recomputed chain value",
      };
    }
    prevHash = entry.hash;
  }
  return { ok: true, count: lines.length };
}

function readLastHash(
  logPath: string,
  fsImpl: Pick<typeof fs, "readFileSync" | "existsSync">,
): string {
  if (!fsImpl.existsSync(logPath)) {
    return "";
  }
  const raw = fsImpl.readFileSync(logPath, "utf8");
  const lines = raw.split("\n").filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (!last) {
    return "";
  }
  try {
    const parsed = JSON.parse(last) as AuditEntry;
    return typeof parsed.hash === "string" ? parsed.hash : "";
  } catch {
    // If the last line is corrupt we still produce a valid chain going
    // forward — verifyAuditLog will then flag the corrupted entry.
    return "";
  }
}

function canonicalJson(value: unknown): string {
  // Stable key ordering so re-serialization for verification matches what
  // we hashed at write time, regardless of how the caller passes the object.
  return JSON.stringify(value, sortedReplacer);
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
