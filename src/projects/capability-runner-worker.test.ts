import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCapabilityRunnerWorker } from "./capability-runner-worker.js";
import { createCapabilityRuntimeLoader } from "./capability-runtime-loader.js";
import { createTaskRecord } from "./task-state.js";
import type { Project, TaskDraft, TaskOrigin } from "./types.js";

const origin: TaskOrigin = { kind: "operator" };
const fixedNow = () => "2026-05-15T12:00:00.000Z";

function makeProject(): Project {
  return {
    id: "p",
    name: "p",
    goal: "g",
    owner: "tester",
    createdAt: fixedNow(),
    status: "active",
    channels: [],
  };
}

function makeTask(input: Record<string, unknown>) {
  const draft: TaskDraft = {
    title: "run capability",
    description: "",
    role: "capability-runner",
    dependsOn: [],
    input,
  };
  return createTaskRecord({
    taskId: "t",
    projectId: "p",
    draft,
    origin,
    now: fixedNow,
  });
}

describe("capability-runner worker", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-runner-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects tasks without a capability id", async () => {
    const loader = createCapabilityRuntimeLoader();
    const worker = createCapabilityRunnerWorker(loader);
    const out = await worker({
      task: makeTask({}),
      project: makeProject(),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/capability/i);
  });

  it("errors clearly when the capability isn't loaded", async () => {
    const loader = createCapabilityRuntimeLoader();
    const worker = createCapabilityRunnerWorker(loader);
    const out = await worker({
      task: makeTask({ capability: "stripe", args: { amount: 99 } }),
      project: makeProject(),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not loaded/);
  });

  it("dispatches to a loaded module and returns its result", async () => {
    const sub = path.join(dir, "echo");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(sub, "index.mjs"),
      `export async function run(input, deps) { return { ok: true, echoed: input.message }; }`,
      "utf8",
    );
    const loader = createCapabilityRuntimeLoader();
    await loader.loadCapability("echo", sub);

    const worker = createCapabilityRunnerWorker(loader);
    const out = await worker({
      task: makeTask({ capability: "echo", args: { message: "hi" } }),
      project: makeProject(),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ ok: true, echoed: "hi" });
  });

  it("surfaces a thrown error from the loaded module", async () => {
    const sub = path.join(dir, "boom");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(sub, "index.mjs"),
      `export async function run() { throw new Error("nope"); }`,
      "utf8",
    );
    const loader = createCapabilityRuntimeLoader();
    await loader.loadCapability("boom", sub);

    const worker = createCapabilityRunnerWorker(loader);
    const out = await worker({
      task: makeTask({ capability: "boom", args: {} }),
      project: makeProject(),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/nope/);
  });
});
