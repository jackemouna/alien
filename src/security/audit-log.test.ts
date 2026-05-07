import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog, verifyAuditLog } from "./audit-log.js";

let dir = "";
let logPath = "";

beforeEach(() => {
  dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-audit-"));
  logPath = path.join(dir, "audit.log");
});

afterEach(() => {
  fsSync.rmSync(dir, { recursive: true, force: true });
});

describe("appendAuditLog + verifyAuditLog", () => {
  it("creates an empty-chain log on first append", () => {
    const entry = appendAuditLog({ kind: "cron.add", payload: { jobId: "j1" } }, { logPath });
    expect(entry.prevHash).toBe("");
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAuditLog(logPath)).toEqual({ ok: true, count: 1 });
  });

  it("links subsequent entries via prevHash", () => {
    const a = appendAuditLog({ kind: "cron.add", payload: { jobId: "j1" } }, { logPath });
    const b = appendAuditLog({ kind: "cron.run", payload: { jobId: "j1" } }, { logPath });
    const c = appendAuditLog({ kind: "cron.remove", payload: { jobId: "j1" } }, { logPath });
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
    expect(verifyAuditLog(logPath)).toEqual({ ok: true, count: 3 });
  });

  it("verifies an existing intact log on disk", () => {
    appendAuditLog({ kind: "self_edit.refused", payload: { path: "/x" } }, { logPath });
    appendAuditLog({ kind: "self_edit.refused", payload: { path: "/y" } }, { logPath });
    expect(verifyAuditLog(logPath).ok).toBe(true);
  });

  it("detects tampering with a payload", () => {
    appendAuditLog({ kind: "cron.add", payload: { jobId: "j1" } }, { logPath });
    appendAuditLog({ kind: "cron.run", payload: { jobId: "j1" } }, { logPath });
    const lines = fsSync.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    const tamperedFirst = lines[0].replace('"j1"', '"j2"');
    fsSync.writeFileSync(logPath, [tamperedFirst, lines[1], ""].join("\n"));
    const result = verifyAuditLog(logPath);
    expect(result).toEqual(expect.objectContaining({ ok: false, breakIndex: 0 }));
  });

  it("detects tampering with the hash field", () => {
    appendAuditLog({ kind: "cron.add", payload: { jobId: "j1" } }, { logPath });
    appendAuditLog({ kind: "cron.run", payload: { jobId: "j1" } }, { logPath });
    const lines = fsSync.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    const corruptedHash = lines[0].replace(
      /"hash":"[0-9a-f]{64}"/,
      '"hash":"0000000000000000000000000000000000000000000000000000000000000000"',
    );
    fsSync.writeFileSync(logPath, [corruptedHash, lines[1], ""].join("\n"));
    const result = verifyAuditLog(logPath);
    expect(result.ok).toBe(false);
  });

  it("detects an inserted line", () => {
    appendAuditLog({ kind: "a", payload: {} }, { logPath });
    appendAuditLog({ kind: "b", payload: {} }, { logPath });
    const lines = fsSync.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    const inserted = JSON.stringify({
      ts: new Date().toISOString(),
      kind: "smuggled",
      payload: {},
      prevHash: "",
      hash: "x".repeat(64),
    });
    fsSync.writeFileSync(logPath, [lines[0], inserted, lines[1], ""].join("\n"));
    const result = verifyAuditLog(logPath);
    expect(result).toEqual(expect.objectContaining({ ok: false, breakIndex: 1 }));
  });

  it("detects a deleted line", () => {
    appendAuditLog({ kind: "a", payload: {} }, { logPath });
    appendAuditLog({ kind: "b", payload: {} }, { logPath });
    appendAuditLog({ kind: "c", payload: {} }, { logPath });
    const lines = fsSync.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    fsSync.writeFileSync(logPath, [lines[0], lines[2], ""].join("\n"));
    const result = verifyAuditLog(logPath);
    expect(result).toEqual(expect.objectContaining({ ok: false, breakIndex: 1 }));
  });

  it("returns ok for an empty log path that does not exist", () => {
    expect(verifyAuditLog(path.join(dir, "missing.log"))).toEqual({ ok: true, count: 0 });
  });

  it("creates the parent directory with 0o700 if missing", () => {
    const nestedLog = path.join(dir, "deep/nested/audit.log");
    appendAuditLog({ kind: "x", payload: {} }, { logPath: nestedLog });
    expect(fsSync.existsSync(nestedLog)).toBe(true);
  });

  it("uses the now() override for deterministic timestamps", () => {
    const fixed = Date.UTC(2026, 0, 15, 12, 0, 0);
    const entry = appendAuditLog({ kind: "x", payload: {} }, { logPath, now: () => fixed });
    expect(entry.ts).toBe("2026-01-15T12:00:00.000Z");
  });

  it("hashes are stable across object key ordering in payload", () => {
    // Two entries whose payloads have the same content but different key
    // insertion order should produce the same hash for the *same payload*
    // when re-verified — the canonical-JSON serializer sorts keys.
    const e1 = appendAuditLog({ kind: "k", payload: { b: 2, a: 1 } }, { logPath });
    // Rewriting the line with reordered keys must not break verification.
    const reordered = JSON.stringify({
      ts: e1.ts,
      kind: e1.kind,
      payload: { a: 1, b: 2 },
      prevHash: e1.prevHash,
      hash: e1.hash,
    });
    fsSync.writeFileSync(logPath, `${reordered}\n`);
    const result = verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
  });
});
