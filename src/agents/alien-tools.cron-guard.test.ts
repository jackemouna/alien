import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAuditLog } from "../security/audit-log.js";
import { runAsChannel, runAsOperator } from "../security/origin-context.js";
import { applyCronWriteGuard } from "./alien-tools.cron-guard.js";
import type { AnyAgentTool } from "./tools/common.js";

function makeFakeCron(): AnyAgentTool & { execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({
    isError: false,
    content: [{ type: "text", text: "ok" }],
  }));
  return { name: "cron", execute } as unknown as AnyAgentTool & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe("applyCronWriteGuard", () => {
  it("delegates read-only actions (status, list, runs) without logging", async () => {
    const base = makeFakeCron();
    const log = vi.fn();
    const guarded = applyCronWriteGuard(base, { envSource: () => ({}), log });
    for (const action of ["status", "list", "runs"]) {
      await guarded.execute("call", { action });
    }
    expect(base.execute).toHaveBeenCalledTimes(3);
    expect(log).not.toHaveBeenCalled();
  });

  it("logs every write action even when allowed", async () => {
    const base = makeFakeCron();
    const log = vi.fn();
    const guarded = applyCronWriteGuard(base, { envSource: () => ({}), log });
    for (const action of ["add", "update", "remove", "run", "wake"]) {
      await guarded.execute("call", { action, jobId: "j1" });
    }
    expect(base.execute).toHaveBeenCalledTimes(5);
    expect(log).toHaveBeenCalledTimes(5);
    for (const call of log.mock.calls) {
      expect(call[0]).toMatch(/cron write action/);
      expect(call[1]).toEqual(expect.objectContaining({ denied: false }));
    }
  });

  it("refuses write actions when ALIEN_DENY_CRON_WRITES=1", async () => {
    const base = makeFakeCron();
    const log = vi.fn();
    const guarded = applyCronWriteGuard(base, {
      envSource: () => ({ ALIEN_DENY_CRON_WRITES: "1" }),
      log,
    });
    const result = await guarded.execute("call", { action: "add", jobId: "j1" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/H3/);
    expect(textOf(result)).toMatch(/ALIEN_DENY_CRON_WRITES/);
    expect(base.execute).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ denied: true }));
  });

  it("passes through read actions even when ALIEN_DENY_CRON_WRITES=1", async () => {
    const base = makeFakeCron();
    const log = vi.fn();
    const guarded = applyCronWriteGuard(base, {
      envSource: () => ({ ALIEN_DENY_CRON_WRITES: "1" }),
      log,
    });
    const result = await guarded.execute("call", { action: "list" });
    expect(result.isError).toBe(false);
    expect(base.execute).toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("treats values other than '1' as not denying", async () => {
    const base = makeFakeCron();
    const log = vi.fn();
    for (const value of ["true", "yes", "0", ""]) {
      const guarded = applyCronWriteGuard(base, {
        envSource: () => ({ ALIEN_DENY_CRON_WRITES: value }),
        log,
      });
      const result = await guarded.execute("call", { action: "add" });
      expect(result.isError).toBe(false);
    }
  });

  it("appends to the audit log when auditLogPath is set (allowed action)", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-cron-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeCron();
      const guarded = applyCronWriteGuard(base, {
        envSource: () => ({}),
        log: vi.fn(),
        auditLogPath,
      });
      await guarded.execute("call", { action: "add", jobId: "j1" });
      const result = verifyAuditLog(auditLogPath);
      expect(result).toEqual({ ok: true, count: 1 });
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"kind":"cron\.add"/);
      expect(raw).toMatch(/"denied":false/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("appends 'cron.refused' to the audit log when denied", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-cron-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeCron();
      const guarded = applyCronWriteGuard(base, {
        envSource: () => ({ ALIEN_DENY_CRON_WRITES: "1" }),
        log: vi.fn(),
        auditLogPath,
      });
      await guarded.execute("call", { action: "remove", jobId: "j2" });
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"kind":"cron\.refused"/);
      expect(raw).toMatch(/"denied":true/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("records currentOrigin in the audit-log payload (channel)", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-cron-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeCron();
      const guarded = applyCronWriteGuard(base, {
        envSource: () => ({}),
        log: vi.fn(),
        auditLogPath,
      });
      await runAsChannel("slack", { senderId: "U7" }, () =>
        guarded.execute("call", { action: "add", jobId: "j1" }),
      );
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"origin":"channel:slack"/);
      expect(raw).toMatch(/"originUntrusted":true/);
      expect(raw).toMatch(/"originDetails":\{"senderId":"U7"\}/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("records 'operator' origin when wrapped in runAsOperator", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-cron-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeCron();
      const guarded = applyCronWriteGuard(base, {
        envSource: () => ({}),
        log: vi.fn(),
        auditLogPath,
      });
      await runAsOperator(() => guarded.execute("call", { action: "remove", jobId: "j1" }));
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"origin":"operator"/);
      expect(raw).toMatch(/"originUntrusted":false/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("records 'unknown' origin when no caller has set one", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-cron-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeCron();
      const guarded = applyCronWriteGuard(base, {
        envSource: () => ({}),
        log: vi.fn(),
        auditLogPath,
      });
      await guarded.execute("call", { action: "add", jobId: "j1" });
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"origin":"unknown"/);
      expect(raw).toMatch(/"originUntrusted":false/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not write to the audit log for read-only actions", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-cron-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeCron();
      const guarded = applyCronWriteGuard(base, {
        envSource: () => ({}),
        log: vi.fn(),
        auditLogPath,
      });
      await guarded.execute("call", { action: "list" });
      expect(fsSync.existsSync(auditLogPath)).toBe(false);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("delegates when the action param is missing or unknown", async () => {
    const base = makeFakeCron();
    const guarded = applyCronWriteGuard(base, {
      envSource: () => ({ ALIEN_DENY_CRON_WRITES: "1" }),
      log: vi.fn(),
    });
    const noAction = await guarded.execute("call", {});
    expect(noAction.isError).toBe(false);
    const unknownAction = await guarded.execute("call", { action: "nonsense" });
    expect(unknownAction.isError).toBe(false);
  });
});

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.map((c) => c.text ?? "").join("\n") ?? "";
}
