import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { verifyAuditLog } from "../security/audit-log.js";
import { runAsChannel } from "../security/origin-context.js";
import { applySelfEditGuard } from "./alien-tools.self-edit-guard.js";
import type { AnyAgentTool } from "./tools/common.js";

function makeFakeTool(): AnyAgentTool & { execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async (_id: string, _params: unknown) => ({
    isError: false,
    content: [{ type: "text", text: "ok" }],
  }));
  return { name: "write", execute } as unknown as AnyAgentTool & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe("applySelfEditGuard", () => {
  const installRoot = "/opt/alien";
  const workspaceRoot = "/Users/op/work";

  it("delegates to base tool for paths outside the install tree", async () => {
    const base = makeFakeTool();
    const guarded = applySelfEditGuard(base, {
      root: workspaceRoot,
      installRoot,
      envSource: () => ({}),
    });
    const result = await guarded.execute("call-1", { path: "/tmp/foo.txt" });
    expect(result.isError).toBe(false);
    expect(base.execute).toHaveBeenCalledWith(
      "call-1",
      { path: "/tmp/foo.txt" },
      undefined,
      undefined,
    );
  });

  it("refuses writes targeting Alien's install tree", async () => {
    const base = makeFakeTool();
    const guarded = applySelfEditGuard(base, {
      root: workspaceRoot,
      installRoot,
      envSource: () => ({}),
    });
    const result = await guarded.execute("call-2", {
      path: `${installRoot}/src/agents/sandbox/runtime-status.ts`,
    });
    expect(result.isError).toBe(true);
    expect(base.execute).not.toHaveBeenCalled();
    expect(textOf(result)).toMatch(/H2/);
  });

  it("resolves a relative path against the workspace root before checking", async () => {
    const base = makeFakeTool();
    const guarded = applySelfEditGuard(base, {
      root: workspaceRoot,
      installRoot,
      envSource: () => ({}),
    });
    // Relative path stays inside workspaceRoot which is outside installRoot — should pass.
    const result = await guarded.execute("call-3", { path: "subdir/file.txt" });
    expect(result.isError).toBe(false);
  });

  it("blocks a relative path that resolves into the install tree", async () => {
    const base = makeFakeTool();
    // Construct a workspace under installRoot so a relative write lands inside Alien.
    const sneakyWorkspace = path.join(installRoot, "leaked-workspace");
    const guarded = applySelfEditGuard(base, {
      root: sneakyWorkspace,
      installRoot,
      envSource: () => ({}),
    });
    const result = await guarded.execute("call-4", { path: "../src/poison.ts" });
    expect(result.isError).toBe(true);
    expect(base.execute).not.toHaveBeenCalled();
  });

  it("respects ALIEN_ALLOW_SELF_EDIT=1 and delegates", async () => {
    const base = makeFakeTool();
    const guarded = applySelfEditGuard(base, {
      root: workspaceRoot,
      installRoot,
      envSource: () => ({ ALIEN_ALLOW_SELF_EDIT: "1" }),
    });
    const result = await guarded.execute("call-5", {
      path: `${installRoot}/src/security/dangerous-tools.ts`,
    });
    expect(result.isError).toBe(false);
    expect(base.execute).toHaveBeenCalled();
  });

  it("delegates when no path param is present (other tool params)", async () => {
    const base = makeFakeTool();
    const guarded = applySelfEditGuard(base, {
      root: workspaceRoot,
      installRoot,
      envSource: () => ({}),
    });
    const result = await guarded.execute("call-6", { something: "else" });
    expect(result.isError).toBe(false);
    expect(base.execute).toHaveBeenCalled();
  });

  describe("audit M4: audit-log integration", () => {
    it("appends a chained 'self_edit.refused' entry on refusal", async () => {
      const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-selfedit-audit-"));
      try {
        const auditLogPath = path.join(tmp, "audit.log");
        const base = makeFakeTool();
        const guarded = applySelfEditGuard(base, {
          root: "/tmp/work",
          installRoot: "/opt/alien",
          envSource: () => ({}),
          auditLogPath,
        });
        const result = await guarded.execute("call-x", {
          path: "/opt/alien/src/foo.ts",
        });
        expect(result.isError).toBe(true);
        const verify = verifyAuditLog(auditLogPath);
        expect(verify).toEqual({ ok: true, count: 1 });
        const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
        expect(raw).toMatch(/"kind":"self_edit\.refused"/);
        expect(raw).toMatch(/"target":"\/opt\/alien\/src\/foo\.ts"/);
      } finally {
        fsSync.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("appends 'self_edit.allowed' when ALIEN_ALLOW_SELF_EDIT=1 lets a write through", async () => {
      const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-selfedit-audit-"));
      try {
        const auditLogPath = path.join(tmp, "audit.log");
        const base = makeFakeTool();
        const guarded = applySelfEditGuard(base, {
          root: "/tmp/work",
          installRoot: "/opt/alien",
          envSource: () => ({ ALIEN_ALLOW_SELF_EDIT: "1" }),
          auditLogPath,
        });
        await guarded.execute("call-y", { path: "/opt/alien/src/foo.ts" });
        const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
        expect(raw).toMatch(/"kind":"self_edit\.allowed"/);
        expect(raw).toMatch(/"target":"\/opt\/alien\/src\/foo\.ts"/);
      } finally {
        fsSync.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("does not write to audit-log for writes outside the install tree", async () => {
      const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-selfedit-audit-"));
      try {
        const auditLogPath = path.join(tmp, "audit.log");
        const base = makeFakeTool();
        const guarded = applySelfEditGuard(base, {
          root: "/tmp/work",
          installRoot: "/opt/alien",
          envSource: () => ({}),
          auditLogPath,
        });
        await guarded.execute("call-z", { path: "/tmp/work/anywhere.txt" });
        expect(fsSync.existsSync(auditLogPath)).toBe(false);
      } finally {
        fsSync.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("captures origin context (M3) in the refusal record", async () => {
      const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-selfedit-audit-"));
      try {
        const auditLogPath = path.join(tmp, "audit.log");
        const base = makeFakeTool();
        const guarded = applySelfEditGuard(base, {
          root: "/tmp/work",
          installRoot: "/opt/alien",
          envSource: () => ({}),
          auditLogPath,
        });
        await runAsChannel("discord", { senderId: "U-attacker" }, () =>
          guarded.execute("call-w", { path: "/opt/alien/src/sandbox/runtime-status.ts" }),
        );
        const raw = fsSync.readFileSync(auditLogPath, "utf8").trim();
        expect(raw).toMatch(/"origin":"channel:discord"/);
        expect(raw).toMatch(/"originUntrusted":true/);
        expect(raw).toMatch(/"originDetails":\{"senderId":"U-attacker"\}/);
      } finally {
        fsSync.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.map((c) => c.text ?? "").join("\n") ?? "";
}
