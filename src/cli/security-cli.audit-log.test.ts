import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendAuditLog } from "../security/audit-log.js";

vi.mock("../runtime.js", () => ({
  defaultRuntime: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    writeJson: vi.fn((value: unknown) => {
      capturedJson.push(value);
    }),
  },
}));

const capturedJson: unknown[] = [];

const { registerSecurityCli } = await import("./security-cli.js");
const { defaultRuntime } = await import("../runtime.js");

let stateDir = "";
let logPath = "";
const originalStateDirEnv = process.env.ALIEN_STATE_DIR;

beforeEach(() => {
  stateDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-audit-log-cli-"));
  logPath = path.join(stateDir, "audit.log");
  process.env.ALIEN_STATE_DIR = stateDir;
  capturedJson.length = 0;
  vi.mocked(defaultRuntime.log).mockClear();
  vi.mocked(defaultRuntime.error).mockClear();
});

afterEach(() => {
  fsSync.rmSync(stateDir, { recursive: true, force: true });
  if (originalStateDirEnv === undefined) {
    delete process.env.ALIEN_STATE_DIR;
  } else {
    process.env.ALIEN_STATE_DIR = originalStateDirEnv;
  }
});

async function runCli(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerSecurityCli(program);
  await program.parseAsync(["node", "alien", "security", ...args]);
}

describe("alien security audit-log", () => {
  it("reports an empty log gracefully", async () => {
    await runCli(["audit-log"]);
    const output = vi
      .mocked(defaultRuntime.log)
      .mock.calls.map((c) => c[0])
      .join("\n");
    expect(output).toMatch(/chain intact/);
    expect(output).toMatch(/\(no entries\)|0 entries/);
  });

  it("reports an intact chain after appends", async () => {
    appendAuditLog({ kind: "cron.add", payload: { jobId: "j1", origin: "operator" } }, { logPath });
    appendAuditLog(
      { kind: "exec.invoked", payload: { command: "ls", origin: "channel:slack" } },
      { logPath },
    );
    await runCli(["audit-log"]);
    const output = vi
      .mocked(defaultRuntime.log)
      .mock.calls.map((c) => c[0])
      .join("\n");
    expect(output).toMatch(/chain intact.*\(2 entries\)/);
    expect(output).toMatch(/cron\.add=1/);
    expect(output).toMatch(/exec\.invoked=1/);
    expect(output).toMatch(/operator=1/);
    expect(output).toMatch(/channel:slack=1/);
  });

  it("flags a broken chain", async () => {
    appendAuditLog({ kind: "cron.add", payload: { jobId: "j1" } }, { logPath });
    appendAuditLog({ kind: "cron.run", payload: { jobId: "j1" } }, { logPath });
    // Tamper with the first entry's payload.
    const lines = fsSync.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    fsSync.writeFileSync(logPath, `${lines[0].replace('"j1"', '"j2"')}\n${lines[1]}\n`);
    await runCli(["audit-log"]);
    const output = vi
      .mocked(defaultRuntime.log)
      .mock.calls.map((c) => c[0])
      .join("\n");
    expect(output).toMatch(/chain broken at index 0/);
  });

  it("--json prints machine-readable output with verification + counts", async () => {
    appendAuditLog(
      { kind: "self_edit.refused", payload: { target: "/x", origin: "channel:discord" } },
      { logPath },
    );
    await runCli(["audit-log", "--json"]);
    expect(capturedJson.length).toBe(1);
    const result = capturedJson[0] as Record<string, unknown>;
    expect(result.logPath).toBe(logPath);
    expect((result.verification as { ok: boolean }).ok).toBe(true);
    expect(result.entryCount).toBe(1);
    expect(result.kindCounts).toEqual({ "self_edit.refused": 1 });
    expect(result.originCounts).toEqual({ "channel:discord": 1 });
    expect(Array.isArray(result.recent)).toBe(true);
  });

  it("--tail caps the recent entries list", async () => {
    for (let i = 0; i < 5; i += 1) {
      appendAuditLog(
        { kind: "exec.invoked", payload: { command: `cmd-${i}`, origin: "operator" } },
        { logPath },
      );
    }
    await runCli(["audit-log", "--tail", "2", "--json"]);
    const result = capturedJson[0] as Record<string, unknown>;
    expect((result.recent as unknown[]).length).toBe(2);
    expect(result.entryCount).toBe(5);
  });

  it("--path overrides the default state-dir path", async () => {
    const customLog = path.join(stateDir, "custom-audit.log");
    appendAuditLog(
      { kind: "cron.add", payload: { jobId: "j-custom", origin: "operator" } },
      { logPath: customLog },
    );
    await runCli(["audit-log", "--path", customLog, "--json"]);
    const result = capturedJson[0] as Record<string, unknown>;
    expect(result.logPath).toBe(customLog);
    expect(result.entryCount).toBe(1);
  });
});
