import { describe, expect, it } from "vitest";
import {
  computeRunStatus,
  createRunFromWorkflow,
  dependencyOutputsFor,
  markTaskFailed,
  markTaskRunning,
  markTaskSucceeded,
  nextRunnableTask,
  resetTaskForRetry,
  withTransitionedStatus,
} from "./run-state.js";
import type { WorkflowDefinition } from "./types.js";

const fixedNow = () => "2026-05-09T12:00:00.000Z";

const linearWorkflow: WorkflowDefinition = {
  id: "test",
  name: "Test",
  tasks: [
    { id: "a", role: "researcher", summary: "a", input: {}, dependsOn: [] },
    { id: "b", role: "writer", summary: "b", input: {}, dependsOn: ["a"] },
    { id: "c", role: "publisher", summary: "c", input: {}, dependsOn: ["b"] },
  ],
};

describe("createRunFromWorkflow", () => {
  it("snapshots task definitions with status=pending and attempts=0", () => {
    const run = createRunFromWorkflow({
      runId: "run-1",
      workflow: linearWorkflow,
      now: fixedNow,
    });
    expect(run.id).toBe("run-1");
    expect(run.workflowId).toBe("test");
    expect(run.createdAt).toBe(fixedNow());
    expect(run.status).toBe("pending");
    expect(run.tasks).toHaveLength(3);
    for (const task of run.tasks) {
      expect(task.status).toBe("pending");
      expect(task.attempts).toBe(0);
    }
  });
});

describe("nextRunnableTask", () => {
  it("returns the first dependency-free pending task", () => {
    const run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    const next = nextRunnableTask(run);
    expect(next?.id).toBe("a");
  });

  it("returns the next task once its dependencies have succeeded", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskSucceeded(markTaskRunning(run, "a"), "a", { result: "alpha" });
    expect(nextRunnableTask(run)?.id).toBe("b");
  });

  it("returns undefined when all tasks are terminal", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    for (const id of ["a", "b", "c"] as const) {
      run = markTaskSucceeded(markTaskRunning(run, id), id, {});
    }
    expect(nextRunnableTask(run)).toBeUndefined();
  });

  it("does not advance past a failed dependency", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskFailed(markTaskRunning(run, "a"), "a", "boom");
    expect(nextRunnableTask(run)).toBeUndefined();
  });
});

describe("markTask*", () => {
  it("running increments attempts and sets startedAt", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskRunning(run, "a", fixedNow);
    const task = run.tasks.find((t) => t.id === "a");
    expect(task?.status).toBe("running");
    expect(task?.startedAt).toBe(fixedNow());
    expect(task?.attempts).toBe(1);
  });

  it("running again on retry increments attempts", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskRunning(run, "a");
    run = markTaskFailed(run, "a", "first failure");
    run = resetTaskForRetry(run, "a");
    run = markTaskRunning(run, "a");
    expect(run.tasks.find((t) => t.id === "a")?.attempts).toBe(2);
  });

  it("succeeded stores the output", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskRunning(run, "a");
    run = markTaskSucceeded(run, "a", { items: [1, 2, 3] });
    const task = run.tasks.find((t) => t.id === "a");
    expect(task?.status).toBe("succeeded");
    expect(task?.output).toEqual({ items: [1, 2, 3] });
  });

  it("failed stores the error message", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskRunning(run, "a");
    run = markTaskFailed(run, "a", "rate-limited");
    const task = run.tasks.find((t) => t.id === "a");
    expect(task?.status).toBe("failed");
    expect(task?.error).toBe("rate-limited");
  });

  it("resetTaskForRetry clears error/timestamps and sets pending", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskRunning(run, "a");
    run = markTaskFailed(run, "a", "x");
    run = resetTaskForRetry(run, "a");
    const task = run.tasks.find((t) => t.id === "a");
    expect(task?.status).toBe("pending");
    expect(task?.error).toBeUndefined();
    expect(task?.startedAt).toBeUndefined();
    expect(task?.completedAt).toBeUndefined();
  });
});

describe("computeRunStatus", () => {
  it("pending while no task has started", () => {
    const run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    expect(computeRunStatus(run)).toBe("pending");
  });

  it("running once a task has started", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskRunning(run, "a");
    expect(computeRunStatus(run)).toBe("running");
  });

  it("running after a task succeeded but more remain runnable", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskSucceeded(markTaskRunning(run, "a"), "a", "ok");
    expect(computeRunStatus(run)).toBe("running");
  });

  it("succeeded when every task succeeded", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    for (const id of ["a", "b", "c"] as const) {
      run = markTaskSucceeded(markTaskRunning(run, id), id, "ok");
    }
    expect(computeRunStatus(run)).toBe("succeeded");
  });

  it("failed when a task failed and no progress remains", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskFailed(markTaskRunning(run, "a"), "a", "boom");
    expect(computeRunStatus(run)).toBe("failed");
  });
});

describe("withTransitionedStatus", () => {
  it("sets startedAt when transitioning out of pending", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskRunning(run, "a", fixedNow);
    run = withTransitionedStatus(run, fixedNow);
    expect(run.startedAt).toBe(fixedNow());
    expect(run.completedAt).toBeUndefined();
  });

  it("sets completedAt when run finishes", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    for (const id of ["a", "b", "c"] as const) {
      run = markTaskSucceeded(markTaskRunning(run, id), id, "ok");
    }
    run = withTransitionedStatus(run, fixedNow);
    expect(run.status).toBe("succeeded");
    expect(run.completedAt).toBe(fixedNow());
  });
});

describe("dependencyOutputsFor", () => {
  it("returns an empty record when the task has no dependencies", () => {
    const run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    expect(dependencyOutputsFor(run, "a")).toEqual({});
  });

  it("includes succeeded dependency outputs keyed by id", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskSucceeded(markTaskRunning(run, "a"), "a", { items: ["x"] });
    expect(dependencyOutputsFor(run, "b")).toEqual({ a: { items: ["x"] } });
  });

  it("excludes pending or failed dependencies", () => {
    let run = createRunFromWorkflow({ runId: "r", workflow: linearWorkflow });
    run = markTaskFailed(markTaskRunning(run, "a"), "a", "boom");
    expect(dependencyOutputsFor(run, "b")).toEqual({});
  });
});
