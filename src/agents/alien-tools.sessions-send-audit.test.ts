import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { verifyAuditLog } from "../security/audit-log.js";
import { runAsChannel, runAsOperator } from "../security/origin-context.js";
import { applySessionsSendAuditLog } from "./alien-tools.sessions-send-audit.js";
import type { AnyAgentTool } from "./tools/common.js";

function makeFakeSessionsSend(
  result: { isError: boolean; status?: string; text?: string } = { isError: false, status: "ok" },
): AnyAgentTool & { execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async () => ({
    isError: result.isError,
    content: [
      {
        type: "text",
        text: result.text ?? JSON.stringify({ runId: "r-1", status: result.status }),
      },
    ],
  }));
  return { name: "sessions_send", execute } as unknown as AnyAgentTool & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe("applySessionsSendAuditLog", () => {
  it("delegates and writes one chained audit entry per invocation", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-sessions-send-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeSessionsSend();
      const guarded = applySessionsSendAuditLog(base, { auditLogPath });
      const result = await guarded.execute("call-1", {
        sessionKey: "agent:beta:abc",
        message: "hello",
      });
      expect(result.isError).toBe(false);
      expect(base.execute).toHaveBeenCalledTimes(1);
      expect(verifyAuditLog(auditLogPath)).toEqual({ ok: true, count: 1 });
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"kind":"sessions_send"/);
      expect(raw).toMatch(/"sessionKey":"agent:beta:abc"/);
      expect(raw).toMatch(/"messageBytes":5/);
      expect(raw).toMatch(/"resultStatus":"ok"/);
      expect(raw).toMatch(/"resultIsError":false/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("captures channel origin (M3) when sessions_send is called inside runAsChannel", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-sessions-send-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeSessionsSend();
      const guarded = applySessionsSendAuditLog(base, { auditLogPath });
      await runAsChannel("slack", { senderId: "U7" }, () =>
        guarded.execute("call-2", { sessionKey: "agent:main", message: "x" }),
      );
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"origin":"channel:slack"/);
      expect(raw).toMatch(/"originUntrusted":true/);
      expect(raw).toMatch(/"originDetails":\{"senderId":"U7"\}/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("captures operator origin when called via runAsOperator", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-sessions-send-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeSessionsSend();
      const guarded = applySessionsSendAuditLog(base, { auditLogPath });
      await runAsOperator(() => guarded.execute("call-op", { label: "main", message: "ping" }));
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"origin":"operator"/);
      expect(raw).toMatch(/"originUntrusted":false/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not write to the audit log when auditLogPath is unset", async () => {
    const base = makeFakeSessionsSend();
    const guarded = applySessionsSendAuditLog(base, {});
    const result = await guarded.execute("call-x", { sessionKey: "k", message: "m" });
    expect(result.isError).toBe(false);
    expect(base.execute).toHaveBeenCalled();
  });

  it("records the error result without crashing on invalid JSON tool output", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-sessions-send-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeSessionsSend({ isError: true, text: "not-json: oops" });
      const guarded = applySessionsSendAuditLog(base, { auditLogPath });
      await guarded.execute("call-3", { sessionKey: "k", message: "m" });
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"resultIsError":true/);
      // No resultStatus when the text wasn't JSON.
      expect(raw).not.toMatch(/"resultStatus"/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("records label + agentId when provided instead of sessionKey", async () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-sessions-send-audit-"));
    try {
      const auditLogPath = path.join(tmp, "audit.log");
      const base = makeFakeSessionsSend();
      const guarded = applySessionsSendAuditLog(base, { auditLogPath });
      await guarded.execute("call-4", {
        label: "researcher",
        agentId: "alpha",
        message: "go",
      });
      const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
      expect(raw).toMatch(/"label":"researcher"/);
      expect(raw).toMatch(/"agentId":"alpha"/);
      expect(raw).not.toMatch(/"sessionKey"/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
