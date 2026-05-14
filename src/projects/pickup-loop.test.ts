import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetFileLockStateForTest } from "../plugin-sdk/file-lock.js";
import {
  runPickupTick,
  startPickupLoop,
  type ProjectWorker,
  type ProjectWorkerRegistry,
} from "./pickup-loop.js";
import { listTasks, saveProject, saveTask } from "./store.js";
import { createTaskRecord } from "./task-state.js";
import type { Project, TaskDraft, TaskOrigin } from "./types.js";

const fixedNow = () => "2026-05-09T12:00:00.000Z";
const origin: TaskOrigin = { kind: "operator" };

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

function makeTaskDraft(role: TaskDraft["role"], deps: string[] = []): TaskDraft {
  return {
    title: `do ${role}`,
    description: "...",
    role,
    dependsOn: deps,
    input: {},
  };
}

function stubWorker(impl: (label: string) => unknown): ProjectWorker {
  return async ({ task }) => ({ ok: true, result: impl(task.title) });
}

function failingWorker(message: string): ProjectWorker {
  return async () => ({ ok: false, error: message });
}

function throwingWorker(): ProjectWorker {
  return async () => {
    throw new Error("worker exploded");
  };
}

describe("runPickupTick", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-projects-pickup-"));
    resetFileLockStateForTest();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    resetFileLockStateForTest();
  });

  it("claims an eligible task, runs the worker, and marks done", async () => {
    saveProject(dir, makeProject("p"));
    saveTask(
      dir,
      createTaskRecord({
        taskId: "t",
        projectId: "p",
        draft: makeTaskDraft("writer"),
        origin,
        now: fixedNow,
      }),
    );
    const workers: ProjectWorkerRegistry = {
      researcher: stubWorker(() => null),
      writer: stubWorker((label) => ({ wrote: label })),
      editor: stubWorker(() => null),
      publisher: stubWorker(() => null),
      "email-handler": stubWorker(() => null),
    };
    await runPickupTick({ projectsDir: dir, workers, claimedBy: "loop-1" });
    const [final] = listTasks(dir, "p");
    expect(final?.status).toBe("done");
    expect(final?.output).toEqual({ wrote: "do writer" });
  });

  it("walks a small chain across multiple ticks", async () => {
    saveProject(dir, makeProject("p"));
    saveTask(
      dir,
      createTaskRecord({
        taskId: "a",
        projectId: "p",
        draft: makeTaskDraft("researcher"),
        origin,
        now: fixedNow,
      }),
    );
    saveTask(
      dir,
      createTaskRecord({
        taskId: "b",
        projectId: "p",
        draft: makeTaskDraft("writer", ["a"]),
        origin,
        now: fixedNow,
      }),
    );
    const seen: string[] = [];
    const workers: ProjectWorkerRegistry = {
      researcher: async ({ task }) => {
        seen.push(`r:${task.id}`);
        return { ok: true, result: { fact: "x" } };
      },
      writer: async ({ task, dependencyOutputs }) => {
        seen.push(`w:${task.id}:${JSON.stringify(dependencyOutputs)}`);
        return { ok: true, result: "draft" };
      },
      editor: stubWorker(() => null),
      publisher: stubWorker(() => null),
      "email-handler": stubWorker(() => null),
    };
    await runPickupTick({ projectsDir: dir, workers, claimedBy: "loop-1" });
    await runPickupTick({ projectsDir: dir, workers, claimedBy: "loop-1" });
    expect(seen).toEqual(["r:a", 'w:b:{"a":{"fact":"x"}}']);
    const after = listTasks(dir, "p").toSorted((x, y) => x.id.localeCompare(y.id));
    expect(after.map((t) => t.status)).toEqual(["done", "done"]);
  });

  it("marks a worker failure as failed without crashing the loop", async () => {
    saveProject(dir, makeProject("p"));
    saveTask(
      dir,
      createTaskRecord({
        taskId: "t",
        projectId: "p",
        draft: makeTaskDraft("publisher"),
        origin,
        now: fixedNow,
      }),
    );
    const workers: ProjectWorkerRegistry = {
      researcher: stubWorker(() => null),
      writer: stubWorker(() => null),
      editor: stubWorker(() => null),
      publisher: failingWorker("oops"),
      "email-handler": stubWorker(() => null),
    };
    await runPickupTick({ projectsDir: dir, workers, claimedBy: "loop-1" });
    const [final] = listTasks(dir, "p");
    expect(final?.status).toBe("failed");
    expect(final?.error).toBe("oops");
  });

  it("catches a thrown worker exception and marks failed", async () => {
    saveProject(dir, makeProject("p"));
    saveTask(
      dir,
      createTaskRecord({
        taskId: "t",
        projectId: "p",
        draft: makeTaskDraft("editor"),
        origin,
        now: fixedNow,
      }),
    );
    const workers: ProjectWorkerRegistry = {
      researcher: stubWorker(() => null),
      writer: stubWorker(() => null),
      editor: throwingWorker(),
      publisher: stubWorker(() => null),
      "email-handler": stubWorker(() => null),
    };
    await runPickupTick({ projectsDir: dir, workers, claimedBy: "loop-1" });
    const [final] = listTasks(dir, "p");
    expect(final?.status).toBe("failed");
    expect(final?.error).toBe("worker exploded");
  });

  it("skips paused projects", async () => {
    saveProject(dir, { ...makeProject("p"), status: "paused" });
    saveTask(
      dir,
      createTaskRecord({
        taskId: "t",
        projectId: "p",
        draft: makeTaskDraft("writer"),
        origin,
        now: fixedNow,
      }),
    );
    const workers: ProjectWorkerRegistry = {
      researcher: stubWorker(() => null),
      writer: stubWorker(() => "ran"),
      editor: stubWorker(() => null),
      publisher: stubWorker(() => null),
      "email-handler": stubWorker(() => null),
    };
    await runPickupTick({ projectsDir: dir, workers, claimedBy: "loop-1" });
    const [final] = listTasks(dir, "p");
    expect(final?.status).toBe("queued");
  });

  it("supports a review hand-off", async () => {
    saveProject(dir, makeProject("p"));
    saveTask(
      dir,
      createTaskRecord({
        taskId: "t",
        projectId: "p",
        draft: makeTaskDraft("editor"),
        origin,
        now: fixedNow,
      }),
    );
    const workers: ProjectWorkerRegistry = {
      researcher: stubWorker(() => null),
      writer: stubWorker(() => null),
      editor: async () => ({ ok: true, result: "draft", toReview: true }),
      publisher: stubWorker(() => null),
      "email-handler": stubWorker(() => null),
    };
    await runPickupTick({ projectsDir: dir, workers, claimedBy: "loop-1" });
    const [final] = listTasks(dir, "p");
    expect(final?.status).toBe("review");
  });
});

describe("startPickupLoop", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-projects-loop-"));
    resetFileLockStateForTest();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    resetFileLockStateForTest();
  });

  it("runs ticks via the injected schedule and stops cleanly", async () => {
    saveProject(dir, makeProject("p"));
    saveTask(
      dir,
      createTaskRecord({
        taskId: "t",
        projectId: "p",
        draft: makeTaskDraft("writer"),
        origin,
        now: fixedNow,
      }),
    );
    let scheduledTick: (() => Promise<void>) | undefined;
    let cancelled = false;
    const workers: ProjectWorkerRegistry = {
      researcher: stubWorker(() => null),
      writer: stubWorker(() => "ok"),
      editor: stubWorker(() => null),
      publisher: stubWorker(() => null),
      "email-handler": stubWorker(() => null),
    };
    const handle = startPickupLoop({
      projectsDir: dir,
      workers,
      claimedBy: "loop-1",
      schedule: (tick) => {
        scheduledTick = tick;
        return () => {
          cancelled = true;
        };
      },
    });
    expect(scheduledTick).toBeTypeOf("function");
    await scheduledTick!();
    handle.stop();
    expect(cancelled).toBe(true);
    const [final] = listTasks(dir, "p");
    expect(final?.status).toBe("done");
  });
});
