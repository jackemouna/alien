import { describe, expect, it } from "vitest";
import type { Worker, WorkerInput } from "../orchestrator/types.js";
import {
  adaptOrchestratorWorker,
  adaptOrchestratorWorkerRegistry,
} from "./orchestrator-worker-adapter.js";
import { createTaskRecord } from "./task-state.js";
import type { Project, TaskDraft, TaskOrigin } from "./types.js";

const fixedNow = () => "2026-05-09T12:00:00.000Z";

function makeProject(): Project {
  return {
    id: "p-1",
    name: "P1",
    goal: "goal",
    owner: "tester",
    createdAt: fixedNow(),
    status: "active",
    channels: [],
    metadata: { custom: "value" },
  };
}

function makeProjectTask(draft: TaskDraft, origin: TaskOrigin = { kind: "operator" }) {
  return createTaskRecord({
    taskId: "t-1",
    projectId: "p-1",
    draft,
    origin,
    now: fixedNow,
  });
}

describe("adaptOrchestratorWorker", () => {
  it("invokes the orchestrator worker with a synthesized run façade", async () => {
    let observed: WorkerInput | undefined;
    const orchWorker: Worker = async (input) => {
      observed = input;
      return { ok: true, result: { echo: input.task.summary } };
    };
    const adapted = adaptOrchestratorWorker(orchWorker);
    const task = makeProjectTask({
      title: "research",
      description: "find facts",
      role: "researcher",
      dependsOn: [],
      input: { topic: "Bun" },
    });
    const out = await adapted({
      task,
      project: makeProject(),
      dependencyOutputs: { upstream: "data" },
    });
    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ echo: "research — find facts" });
    expect(observed?.task.id).toBe("t-1");
    expect(observed?.task.role).toBe("researcher");
    expect(observed?.dependencyOutputs).toEqual({ upstream: "data" });
    expect(observed?.run.id).toBe("project-p-1");
    expect(observed?.run.metadata).toEqual({ custom: "value" });
  });

  it("uses title alone when description is empty or equal", async () => {
    let observed: WorkerInput | undefined;
    const orchWorker: Worker = async (input) => {
      observed = input;
      return { ok: true };
    };
    const adapted = adaptOrchestratorWorker(orchWorker);
    const task = makeProjectTask({
      title: "write",
      description: "write",
      role: "writer",
      dependsOn: [],
      input: {},
    });
    await adapted({ task, project: makeProject(), dependencyOutputs: {} });
    expect(observed?.task.summary).toBe("write");
  });

  it("propagates worker failures", async () => {
    const orchWorker: Worker = async () => ({ ok: false, error: "nope" });
    const adapted = adaptOrchestratorWorker(orchWorker);
    const out = await adapted({
      task: makeProjectTask({
        title: "t",
        description: "d",
        role: "editor",
        dependsOn: [],
        input: {},
      }),
      project: makeProject(),
      dependencyOutputs: {},
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("nope");
  });
});

describe("adaptOrchestratorWorkerRegistry", () => {
  it("wraps every role in the registry", () => {
    const noop: Worker = async () => ({ ok: true });
    const adapted = adaptOrchestratorWorkerRegistry({
      researcher: noop,
      writer: noop,
      editor: noop,
      publisher: noop,
    });
    expect(typeof adapted.researcher).toBe("function");
    expect(typeof adapted.writer).toBe("function");
    expect(typeof adapted.editor).toBe("function");
    expect(typeof adapted.publisher).toBe("function");
  });
});
