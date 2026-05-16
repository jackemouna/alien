import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCapabilityBrokerWorker } from "./capability-broker.js";
import { readCapabilityRequests } from "./capability-requests-store.js";
import { loadProject, saveProject } from "./store.js";
import { createTaskRecord } from "./task-state.js";
import type { Project, TaskDraft, TaskOrigin, TaskRecord } from "./types.js";

const operatorOrigin: TaskOrigin = { kind: "operator" };
const fixedNow = () => "2026-05-15T12:00:00.000Z";

function makeProject(id: string): Project {
  return {
    id,
    name: id,
    goal: "test goal",
    owner: "tester",
    createdAt: fixedNow(),
    status: "active",
    channels: [],
  };
}

function makeBrokerTask(input: Record<string, unknown>): TaskRecord {
  const draft: TaskDraft = {
    title: "request capability",
    description: "we need integration X",
    role: "capability-broker",
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

describe("capability-broker", () => {
  let dir: string;
  let stateDir: string;
  let originalStateDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-projects-broker-"));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-state-broker-"));
    originalStateDir = process.env.ALIEN_STATE_DIR;
    process.env.ALIEN_STATE_DIR = stateDir;
    const project = makeProject("p-1");
    saveProject(dir, project);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
    if (originalStateDir === undefined) {
      delete process.env.ALIEN_STATE_DIR;
    } else {
      process.env.ALIEN_STATE_DIR = originalStateDir;
    }
  });

  it("rejects requests with missing integration or why", async () => {
    const broker = createCapabilityBrokerWorker({ projectsDir: dir });
    const out = await broker({
      task: makeBrokerTask({ why: "no integration field" }),
      project: makeProject("p-1"),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/integration, why/);
  });

  it("short-circuits known capabilities with a friendly pointer", async () => {
    const broker = createCapabilityBrokerWorker({ projectsDir: dir });
    const out = await broker({
      task: makeBrokerTask({ integration: "researcher", why: "want to research" }),
      project: makeProject("p-1"),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/already exists/);
    expect(out.error).toMatch(/researcher/);
  });

  it("records new requests, flips project to needs-input, and returns ok", async () => {
    const broker = createCapabilityBrokerWorker({
      projectsDir: dir,
      now: fixedNow,
    });
    const out = await broker({
      task: makeBrokerTask({
        integration: "stripe",
        why: "charge customers via card",
        sketch: "expose createCharge(amount, customerId)",
      }),
      project: makeProject("p-1"),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(true);
    const result = out.result as { capabilityRequested?: { integration?: string } };
    expect(result.capabilityRequested?.integration).toBe("stripe");

    const requests = await readCapabilityRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.integration).toBe("stripe");
    expect(requests[0]?.why).toBe("charge customers via card");
    expect(requests[0]?.status).toBe("open");

    const updated = loadProject(dir, "p-1");
    expect(updated?.status).toBe("needs-input");
    expect(
      (updated?.metadata as Record<string, unknown> | undefined)?.pendingCapabilityRequestId,
    ).toBeDefined();
  });

  it("matches channel-prefixed capability ids as well", async () => {
    const broker = createCapabilityBrokerWorker({ projectsDir: dir });
    const out = await broker({
      task: makeBrokerTask({ integration: "slack", why: "wanted slack" }),
      project: makeProject("p-1"),
      dependencyOutputs: {},
    });
    // "slack" maps to "channel:slack" in the catalog — should short-circuit.
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/already exists/);
  });
});
