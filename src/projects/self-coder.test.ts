import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStubLlmClient } from "../orchestrator/llm-client.js";
import { appendCapabilityRequest, readCapabilityRequests } from "./capability-requests-store.js";
import { createSelfCoderWorker } from "./self-coder.js";
import { createTaskRecord } from "./task-state.js";
import type { Project, TaskDraft, TaskOrigin, TaskRecord } from "./types.js";

const operatorOrigin: TaskOrigin = { kind: "operator" };
const fixedNow = () => "2026-05-15T12:00:00.000Z";

function makeProject(id: string): Project {
  return {
    id,
    name: id,
    goal: "test",
    owner: "tester",
    createdAt: fixedNow(),
    status: "active",
    channels: [],
  };
}

function makeTask(input: Record<string, unknown>): TaskRecord {
  const draft: TaskDraft = {
    title: "generate",
    description: "self-code a capability",
    role: "self-coder",
    dependsOn: [],
    input,
  };
  return createTaskRecord({
    taskId: "t-1",
    projectId: "p-1",
    draft,
    origin: operatorOrigin,
    now: fixedNow,
  });
}

describe("self-coder", () => {
  let stateDir: string;
  let generatedRoot: string;
  let originalStateDir: string | undefined;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-self-coder-"));
    generatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alien-self-coder-out-"));
    originalStateDir = process.env.ALIEN_STATE_DIR;
    process.env.ALIEN_STATE_DIR = stateDir;
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(generatedRoot, { recursive: true, force: true });
    if (originalStateDir === undefined) {
      delete process.env.ALIEN_STATE_DIR;
    } else {
      process.env.ALIEN_STATE_DIR = originalStateDir;
    }
  });

  it("rejects tasks without requestId", async () => {
    const worker = createSelfCoderWorker({
      llm: createStubLlmClient(() => '{"files":[]}'),
      generatedRoot,
    });
    const out = await worker({
      task: makeTask({}),
      project: makeProject("p-1"),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/requestId/);
  });

  it("rejects when the capability request is not in the store", async () => {
    const worker = createSelfCoderWorker({
      llm: createStubLlmClient(() => '{"files":[]}'),
      generatedRoot,
    });
    const out = await worker({
      task: makeTask({ requestId: "cap-doesnotexist" }),
      project: makeProject("p-1"),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not found/);
  });

  it("writes generated files into the sandbox, marks request fulfilled, and returns toReview", async () => {
    await appendCapabilityRequest({
      id: "cap-stripe",
      projectId: "p-1",
      taskId: "t-prev",
      integration: "stripe",
      why: "charge customers",
      sketch: "createCharge(amount, customerId)",
      createdAt: fixedNow(),
      status: "open",
    });
    const generated = {
      files: [
        { path: "index.mjs", contents: "export async function run() { return {}; }" },
        { path: "types.d.ts", contents: "export type Input = {}; export type Output = {};" },
        { path: "README.md", contents: "# stripe stub\nTODO: real impl" },
      ],
    };
    const worker = createSelfCoderWorker({
      llm: createStubLlmClient(() => ({
        text: JSON.stringify(generated),
        usage: { inputTokens: 1000, outputTokens: 2000, model: "claude-sonnet-4-6" },
      })),
      generatedRoot,
    });

    const out = await worker({
      task: makeTask({ requestId: "cap-stripe" }),
      project: makeProject("p-1"),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(true);
    expect(out.toReview).toBe(true);
    const stripeDir = path.join(generatedRoot, "stripe");
    expect(fs.existsSync(path.join(stripeDir, "index.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(stripeDir, "types.d.ts"))).toBe(true);
    expect(fs.existsSync(path.join(stripeDir, "README.md"))).toBe(true);
    expect(fs.readFileSync(path.join(stripeDir, "README.md"), "utf8")).toMatch(/stripe stub/);

    const requests = await readCapabilityRequests();
    const updated = requests.find((r) => r.id === "cap-stripe");
    expect(updated?.status).toBe("fulfilled");
    expect(updated?.resolution).toMatch(/stripe/);

    // Cost is computed from usage tokens.
    expect(typeof out.costUsd).toBe("number");
    expect(out.costUsd).toBeGreaterThan(0);
  });

  it("blocks sandbox escape attempts (../ in path)", async () => {
    await appendCapabilityRequest({
      id: "cap-evil",
      projectId: "p-1",
      taskId: "t-1",
      integration: "evil",
      why: "test",
      createdAt: fixedNow(),
      status: "open",
    });
    const evil = {
      files: [
        { path: "../../escape.ts", contents: "I should not exist" },
        { path: "index.ts", contents: "ok" },
      ],
    };
    const worker = createSelfCoderWorker({
      llm: createStubLlmClient(() => JSON.stringify(evil)),
      generatedRoot,
    });
    const out = await worker({
      task: makeTask({ requestId: "cap-evil" }),
      project: makeProject("p-1"),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/sandbox/);
    expect(fs.existsSync(path.resolve(generatedRoot, "..", "escape.ts"))).toBe(false);
  });

  it("refuses to regenerate an already-fulfilled request", async () => {
    await appendCapabilityRequest({
      id: "cap-done",
      projectId: "p-1",
      taskId: "t-1",
      integration: "done",
      why: "test",
      createdAt: fixedNow(),
      status: "fulfilled",
    });
    const worker = createSelfCoderWorker({
      llm: createStubLlmClient(() => '{"files":[]}'),
      generatedRoot,
    });
    const out = await worker({
      task: makeTask({ requestId: "cap-done" }),
      project: makeProject("p-1"),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/already fulfilled/);
  });
});
