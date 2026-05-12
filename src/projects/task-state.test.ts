import { describe, expect, it } from "vitest";
import {
  approveTaskForQueue,
  createTaskRecord,
  findEligibleTask,
  isProjectIdle,
  isTaskEligibleForPickup,
  markTaskBlocked,
  markTaskClaimed,
  markTaskDone,
  markTaskFailed,
  markTaskInReview,
  resetTaskForRetry,
} from "./task-state.js";
import type { Project, TaskDraft, TaskOrigin, TaskRecord } from "./types.js";

const fixedNow = () => "2026-05-09T12:00:00.000Z";
const laterNow = () => "2026-05-09T13:00:00.000Z";
const operatorOrigin: TaskOrigin = { kind: "operator" };

function draft(overrides: Partial<TaskDraft> & Pick<TaskDraft, "role" | "title">): TaskDraft {
  return {
    description: overrides.description ?? "...",
    dependsOn: overrides.dependsOn ?? [],
    input: overrides.input ?? {},
    ...overrides,
  };
}

function task(
  id: string,
  overrides: Partial<TaskRecord> & Pick<TaskRecord, "role"> = { role: "writer" },
): TaskRecord {
  const { role, title, dependsOn, input, priority, requiresApproval } = overrides;
  return createTaskRecord({
    taskId: id,
    projectId: "proj-1",
    draft: draft({
      role,
      title: title ?? id,
      ...(dependsOn ? { dependsOn } : {}),
      ...(input ? { input } : {}),
      ...(priority ? { priority } : {}),
      ...(requiresApproval ? { requiresApproval } : {}),
    }),
    origin: operatorOrigin,
    now: fixedNow,
  });
}

describe("createTaskRecord", () => {
  it("starts as queued with attempts=0", () => {
    const t = createTaskRecord({
      taskId: "t-1",
      projectId: "proj-1",
      draft: draft({ role: "researcher", title: "Find" }),
      origin: operatorOrigin,
      now: fixedNow,
    });
    expect(t.status).toBe("queued");
    expect(t.attempts).toBe(0);
    expect(t.createdAt).toBe(fixedNow());
    expect(t.priority).toBe("normal");
    expect(t.requiresApproval).toBeUndefined();
  });

  it("starts as backlog when requiresApproval is set", () => {
    const t = createTaskRecord({
      taskId: "t-1",
      projectId: "proj-1",
      draft: draft({ role: "publisher", title: "Send", requiresApproval: true }),
      origin: operatorOrigin,
    });
    expect(t.status).toBe("backlog");
    expect(t.requiresApproval).toBe(true);
  });
});

describe("isTaskEligibleForPickup", () => {
  it("requires queued + unclaimed + all deps done", () => {
    const a = markTaskDone(task("a", { role: "researcher" }), { ok: 1 });
    const b = task("b", { role: "writer", dependsOn: ["a"] });
    expect(isTaskEligibleForPickup(b, [a, b])).toBe(true);
  });

  it("blocks when a dep is not done", () => {
    const a = task("a", { role: "researcher" }); // still queued
    const b = task("b", { role: "writer", dependsOn: ["a"] });
    expect(isTaskEligibleForPickup(b, [a, b])).toBe(false);
  });

  it("blocks when status is backlog or in-progress", () => {
    const t = createTaskRecord({
      taskId: "t",
      projectId: "p",
      draft: draft({ role: "writer", title: "x", requiresApproval: true }),
      origin: operatorOrigin,
    });
    expect(isTaskEligibleForPickup(t, [t])).toBe(false);
    const claimed = markTaskClaimed(approveTaskForQueue(t), "worker-1");
    expect(isTaskEligibleForPickup(claimed, [claimed])).toBe(false);
  });
});

describe("findEligibleTask priority", () => {
  it("prefers higher priority, then older createdAt", () => {
    const low = createTaskRecord({
      taskId: "low",
      projectId: "p",
      draft: draft({ role: "writer", title: "low", priority: "low" }),
      origin: operatorOrigin,
      now: fixedNow,
    });
    const urgent = createTaskRecord({
      taskId: "urgent",
      projectId: "p",
      draft: draft({ role: "writer", title: "urgent", priority: "urgent" }),
      origin: operatorOrigin,
      now: laterNow,
    });
    const picked = findEligibleTask([low, urgent], "writer");
    expect(picked?.id).toBe("urgent");
  });

  it("returns undefined when no role match", () => {
    const t = task("a", { role: "writer" });
    expect(findEligibleTask([t], "researcher")).toBeUndefined();
  });
});

describe("transitions", () => {
  it("claim → done", () => {
    const t = task("t");
    const claimed = markTaskClaimed(t, "worker-1", fixedNow);
    expect(claimed.status).toBe("in-progress");
    expect(claimed.attempts).toBe(1);
    const done = markTaskDone(claimed, { result: "ok" }, laterNow);
    expect(done.status).toBe("done");
    expect(done.output).toEqual({ result: "ok" });
    expect(done.completedAt).toBe(laterNow());
  });

  it("claim → review", () => {
    const claimed = markTaskClaimed(task("t"), "worker-1", fixedNow);
    const review = markTaskInReview(claimed, { draft: "x" }, laterNow);
    expect(review.status).toBe("review");
  });

  it("claim → failed", () => {
    const claimed = markTaskClaimed(task("t"), "worker-1");
    const failed = markTaskFailed(claimed, "boom");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("boom");
  });

  it("blocked carries reason", () => {
    const blocked = markTaskBlocked(task("t"), "upstream failed");
    expect(blocked.status).toBe("blocked");
    expect(blocked.error).toBe("upstream failed");
  });

  it("reset returns to queued and clears claim/error", () => {
    let t = markTaskClaimed(task("t"), "worker-1");
    t = markTaskFailed(t, "boom");
    const retried = resetTaskForRetry(t);
    expect(retried.status).toBe("queued");
    expect(retried.error).toBeUndefined();
    expect(retried.claimedBy).toBeUndefined();
  });
});

describe("approveTaskForQueue", () => {
  it("moves backlog → queued and clears requiresApproval", () => {
    const t = createTaskRecord({
      taskId: "t",
      projectId: "p",
      draft: draft({ role: "publisher", title: "x", requiresApproval: true }),
      origin: operatorOrigin,
    });
    const approved = approveTaskForQueue(t);
    expect(approved.status).toBe("queued");
    expect(approved.requiresApproval).toBeUndefined();
  });

  it("is a no-op for non-backlog tasks", () => {
    const t = task("t");
    expect(approveTaskForQueue(t)).toBe(t);
  });
});

describe("isProjectIdle", () => {
  const project: Project = {
    id: "p",
    name: "P",
    goal: "g",
    owner: "u",
    createdAt: fixedNow(),
    status: "active",
    channels: [],
  };

  it("true when every task is terminal", () => {
    const done = markTaskDone(markTaskClaimed(task("a"), "w"), { x: 1 });
    expect(isProjectIdle(project, [done])).toBe(true);
  });

  it("false while a task is queued", () => {
    expect(isProjectIdle(project, [task("a")])).toBe(false);
  });

  it("true when project is paused or archived regardless of tasks", () => {
    expect(isProjectIdle({ ...project, status: "paused" }, [task("a")])).toBe(true);
    expect(isProjectIdle({ ...project, status: "archived" }, [task("a")])).toBe(true);
  });
});
