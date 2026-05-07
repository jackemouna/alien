import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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
});

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.map((c) => c.text ?? "").join("\n") ?? "";
}
