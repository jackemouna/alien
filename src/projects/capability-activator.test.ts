import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readActivatedCapabilities } from "./activated-capabilities-store.js";
import {
  activateCapability,
  deactivateCapability,
  readReasoningTrace,
} from "./capability-activator.js";
import { appendCapabilityRequest } from "./capability-requests-store.js";
import { createCapabilityRuntimeLoader } from "./capability-runtime-loader.js";

const fixedNow = () => "2026-05-15T12:00:00.000Z";

describe("capability-activator", () => {
  let stateDir: string;
  let generatedRoot: string;
  let activeRoot: string;
  let originalStateDir: string | undefined;

  beforeEach(async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-activator-state-"));
    generatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alien-activator-gen-"));
    activeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alien-activator-active-"));
    originalStateDir = process.env.ALIEN_STATE_DIR;
    process.env.ALIEN_STATE_DIR = stateDir;
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(generatedRoot, { recursive: true, force: true });
    fs.rmSync(activeRoot, { recursive: true, force: true });
    if (originalStateDir === undefined) {
      delete process.env.ALIEN_STATE_DIR;
    } else {
      process.env.ALIEN_STATE_DIR = originalStateDir;
    }
  });

  function writeGenerated(id: string, files: Record<string, string>): void {
    const dir = path.join(generatedRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), contents);
    }
  }

  it("refuses to activate an unknown request", async () => {
    const out = await activateCapability("cap-missing", {
      generatedRoot,
      activeRoot,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/unknown/i);
  });

  it("refuses to activate a request that's not yet fulfilled", async () => {
    await appendCapabilityRequest({
      id: "cap-pending",
      projectId: "p",
      taskId: "t",
      integration: "pending",
      why: "test",
      createdAt: fixedNow(),
      status: "open",
    });
    const out = await activateCapability("cap-pending", { generatedRoot, activeRoot });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/fulfilled/);
  });

  it("activates a fulfilled request, copies files, persists the record", async () => {
    await appendCapabilityRequest({
      id: "cap-stripe",
      projectId: "p",
      taskId: "t",
      integration: "stripe",
      why: "charge customers",
      createdAt: fixedNow(),
      status: "fulfilled",
    });
    writeGenerated("stripe", {
      "index.ts": "export const run = async () => ({ ok: true });",
      "README.md": "# stripe stub",
    });
    const out = await activateCapability("cap-stripe", {
      generatedRoot,
      activeRoot,
      now: fixedNow,
      actor: "tester",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.newlyActivated).toBe(true);
    expect(out.record.status).toBe("active");
    expect(out.record.activatedBy).toBe("tester");
    expect(fs.existsSync(path.join(activeRoot, "stripe", "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(activeRoot, "stripe", "README.md"))).toBe(true);

    const records = await readActivatedCapabilities();
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("stripe");
  });

  it("is idempotent: second activate returns the existing record", async () => {
    await appendCapabilityRequest({
      id: "cap-twice",
      projectId: "p",
      taskId: "t",
      integration: "twice",
      why: "test",
      createdAt: fixedNow(),
      status: "fulfilled",
    });
    writeGenerated("twice", { "index.ts": "a" });
    const first = await activateCapability("cap-twice", {
      generatedRoot,
      activeRoot,
      now: fixedNow,
    });
    const second = await activateCapability("cap-twice", {
      generatedRoot,
      activeRoot,
      now: fixedNow,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.newlyActivated).toBe(false);
      expect(second.record.activatedAt).toBe(first.record.activatedAt);
    }
  });

  it("refuses to activate if any source entry is a symlink", async () => {
    await appendCapabilityRequest({
      id: "cap-sym",
      projectId: "p",
      taskId: "t",
      integration: "sym",
      why: "test",
      createdAt: fixedNow(),
      status: "fulfilled",
    });
    const srcDir = path.join(generatedRoot, "sym");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "real.ts"), "ok");
    // Point a symlink at /etc/passwd-equivalent (use os.tmpdir for portability).
    fs.symlinkSync(os.tmpdir(), path.join(srcDir, "evil.lnk"));
    const out = await activateCapability("cap-sym", { generatedRoot, activeRoot });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/symlink/);
    // Active dir should not have been populated.
    expect(fs.existsSync(path.join(activeRoot, "sym", "real.ts"))).toBe(false);
  });

  it("deactivate removes the active-dir copy, flips status, leaves sandbox copy", async () => {
    await appendCapabilityRequest({
      id: "cap-roll",
      projectId: "p",
      taskId: "t",
      integration: "roll",
      why: "test",
      createdAt: fixedNow(),
      status: "fulfilled",
    });
    writeGenerated("roll", { "index.ts": "ok" });
    const act = await activateCapability("cap-roll", { generatedRoot, activeRoot, now: fixedNow });
    expect(act.ok).toBe(true);

    const out = await deactivateCapability("cap-roll", "looked wrong on review", {
      generatedRoot,
      activeRoot,
      now: () => "2026-05-15T13:00:00.000Z",
      actor: "reviewer",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.record.status).toBe("rolled-back");
    expect(out.record.rollbackReason).toBe("looked wrong on review");
    expect(fs.existsSync(path.join(activeRoot, "roll"))).toBe(false);
    expect(fs.existsSync(path.join(generatedRoot, "roll", "index.ts"))).toBe(true);
  });

  it("hot-loads via the loader on activate, drops cache on deactivate", async () => {
    await appendCapabilityRequest({
      id: "cap-hot",
      projectId: "p",
      taskId: "t",
      integration: "hot",
      why: "test",
      createdAt: fixedNow(),
      status: "fulfilled",
    });
    // Self-coder now writes index.mjs; the loader needs a real ESM file.
    const sub = path.join(generatedRoot, "hot");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(sub, "index.mjs"),
      "export async function run() { return { hot: true }; }",
      "utf8",
    );

    const loader = createCapabilityRuntimeLoader();
    const act = await activateCapability("cap-hot", {
      generatedRoot,
      activeRoot,
      loader,
      now: fixedNow,
    });
    expect(act.ok).toBe(true);
    expect(loader.getCapability("hot")).toBeDefined();

    const deact = await deactivateCapability("cap-hot", "test rollback", {
      generatedRoot,
      activeRoot,
      loader,
      now: fixedNow,
    });
    expect(deact.ok).toBe(true);
    expect(loader.getCapability("hot")).toBeUndefined();
  });

  it("readReasoningTrace returns request + activation + sources", async () => {
    await appendCapabilityRequest({
      id: "cap-trace",
      projectId: "p",
      taskId: "t",
      integration: "trace",
      why: "we want to trace it",
      createdAt: fixedNow(),
      status: "fulfilled",
    });
    writeGenerated("trace", { "index.ts": "x" });
    await activateCapability("cap-trace", { generatedRoot, activeRoot, now: fixedNow });

    const trace = await readReasoningTrace("cap-trace");
    expect(trace.request?.integration).toBe("trace");
    expect(trace.activation?.status).toBe("active");
    expect(trace.trace.sources.length).toBeGreaterThan(0);
  });
});
