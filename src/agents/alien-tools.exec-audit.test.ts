import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { verifyAuditLog } from "../security/audit-log.js";
import { runAsChannel } from "../security/origin-context.js";
import { applyExecAuditLog } from "./alien-tools.exec-audit.js";
import type { AnyAgentTool } from "./tools/common.js";

function makeFakeExec(
  result: { isError?: boolean; exitCode?: number | null; durationMs?: number } = {
    isError: false,
    exitCode: 0,
    durationMs: 42,
  },
): AnyAgentTool & { execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({
    isError: result.isError ?? false,
    content: [{ type: "text", text: "stdout-here" }],
    details: {
      exitCode: result.exitCode ?? 0,
      durationMs: result.durationMs ?? 42,
    },
  }));
  return { name: "exec", execute } as unknown as AnyAgentTool & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe("applyExecAuditLog", () => {
  it("delegates and writes a chained audit entry per invocation", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-exec-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeExec();
      const guarded = applyExecAuditLog(base, { auditLogPath, envSource: () => ({}) });
      const result = await guarded.execute("call-1", {
        command: "ls -la /tmp",
        host: "gateway",
      });
      expect(result.isError).toBe(false);
      expect(verifyAuditLog(auditLogPath)).toEqual({ ok: true, count: 1 });
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"kind":"exec\.invoked"/);
      expect(raw).toMatch(/"command":"ls -la \/tmp"/);
      expect(raw).toMatch(/"host":"gateway"/);
      expect(raw).toMatch(/"exitCode":0/);
      expect(raw).toMatch(/"durationMs":42/);
      expect(raw).toMatch(/"resultIsError":false/);
      expect(raw).toMatch(/"commandTruncated":false/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("redacts secrets in the logged command", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-exec-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeExec();
      const guarded = applyExecAuditLog(base, { auditLogPath, envSource: () => ({}) });
      await guarded.execute("call-2", {
        command: "curl -H 'Authorization: Bearer sk-1234567890abcdef1234'",
      });
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).not.toMatch(/sk-1234567890abcdef1234/);
      // The Bearer prefix and curl framing should still be visible enough
      // to identify what the command was doing.
      expect(raw).toMatch(/curl/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("truncates very long commands and sets commandTruncated=true", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-exec-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeExec();
      const guarded = applyExecAuditLog(base, { auditLogPath, envSource: () => ({}) });
      const longCommand = `echo ${"x".repeat(500)}`;
      await guarded.execute("call-3", { command: longCommand });
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"commandTruncated":true/);
      // Original full command is not present.
      expect(raw).not.toContain(`echo ${"x".repeat(500)}`);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("captures channel origin (M3) when invoked under runAsChannel", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-exec-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeExec();
      const guarded = applyExecAuditLog(base, { auditLogPath, envSource: () => ({}) });
      await runAsChannel("discord", { senderId: "U-attacker" }, () =>
        guarded.execute("call-4", { command: "rm -rf /important" }),
      );
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"origin":"channel:discord"/);
      expect(raw).toMatch(/"originUntrusted":true/);
      expect(raw).toMatch(/"originDetails":\{"senderId":"U-attacker"\}/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("records error results and non-zero exit codes", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-exec-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeExec({ isError: true, exitCode: 127, durationMs: 5 });
      const guarded = applyExecAuditLog(base, { auditLogPath, envSource: () => ({}) });
      await guarded.execute("call-5", { command: "missing-binary" });
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"resultIsError":true/);
      expect(raw).toMatch(/"exitCode":127/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips writing when ALIEN_AUDIT_LOG_EXEC=0", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-exec-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeExec();
      const guarded = applyExecAuditLog(base, {
        auditLogPath,
        envSource: () => ({ ALIEN_AUDIT_LOG_EXEC: "0" }),
      });
      await guarded.execute("call-6", { command: "ls" });
      expect(fsSync.existsSync(auditLogPath)).toBe(false);
      expect(base.execute).toHaveBeenCalled();
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips writing when auditLogPath is unset", async () => {
    const base = makeFakeExec();
    const guarded = applyExecAuditLog(base, { envSource: () => ({}) });
    const result = await guarded.execute("call-7", { command: "ls" });
    expect(result.isError).toBe(false);
    expect(base.execute).toHaveBeenCalled();
  });

  it("does not log stdout/stderr content from the tool result", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-exec-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeExec();
      // Override the fake to return potentially-sensitive stdout content.
      base.execute.mockResolvedValueOnce({
        isError: false,
        content: [{ type: "text", text: "STOLEN_SECRET=hunter2-xyzzy-leaked" }],
        details: { exitCode: 0, durationMs: 1 },
      });
      const guarded = applyExecAuditLog(base, { auditLogPath, envSource: () => ({}) });
      await guarded.execute("call-8", { command: "printenv" });
      const raw = fsSync.readFileSync(auditLogPath, "utf8");
      expect(raw).not.toContain("hunter2-xyzzy-leaked");
      expect(raw).not.toContain("STOLEN_SECRET");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
