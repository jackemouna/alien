import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetFileLockStateForTest } from "../plugin-sdk/file-lock.js";
import { saveProject, saveTask } from "./store.js";
import { claimTask } from "./task-claim.js";
import { createTaskRecord, markTaskDone } from "./task-state.js";
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

describe("claimTask", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-projects-claim-"));
    resetFileLockStateForTest();
  });

  afterEach(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    resetFileLockStateForTest();
  });

  it("returns no-eligible-task when project has no tasks", async () => {
    saveProject(dir, makeProject("p"));
    const result = await claimTask({
      projectsDir: dir,
      projectId: "p",
      role: "writer",
      claimedBy: "worker-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-eligible-task");
    }
  });

  it("claims a queued task and persists the claim", async () => {
    saveProject(dir, makeProject("p"));
    const t = createTaskRecord({
      taskId: "t-1",
      projectId: "p",
      draft: makeTaskDraft("writer"),
      origin,
      now: fixedNow,
    });
    saveTask(dir, t);
    const result = await claimTask({
      projectsDir: dir,
      projectId: "p",
      role: "writer",
      claimedBy: "worker-1",
      now: () => "2026-05-09T13:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.status).toBe("in-progress");
      expect(result.task.claimedBy).toBe("worker-1");
      expect(result.task.attempts).toBe(1);
    }
  });

  it("only claims tasks whose dependencies are done", async () => {
    saveProject(dir, makeProject("p"));
    const a = createTaskRecord({
      taskId: "a",
      projectId: "p",
      draft: makeTaskDraft("researcher"),
      origin,
      now: fixedNow,
    });
    const b = createTaskRecord({
      taskId: "b",
      projectId: "p",
      draft: makeTaskDraft("writer", ["a"]),
      origin,
      now: fixedNow,
    });
    saveTask(dir, a);
    saveTask(dir, b);

    // b is not yet eligible — a is still queued.
    const blocked = await claimTask({
      projectsDir: dir,
      projectId: "p",
      role: "writer",
      claimedBy: "worker-1",
    });
    expect(blocked.ok).toBe(false);

    // Complete a → b becomes eligible.
    saveTask(dir, markTaskDone(a, { ok: true }));
    const claim = await claimTask({
      projectsDir: dir,
      projectId: "p",
      role: "writer",
      claimedBy: "worker-1",
    });
    expect(claim.ok).toBe(true);
  });

  it("two concurrent claims yield exactly one winner", async () => {
    saveProject(dir, makeProject("p"));
    const t = createTaskRecord({
      taskId: "t",
      projectId: "p",
      draft: makeTaskDraft("writer"),
      origin,
      now: fixedNow,
    });
    saveTask(dir, t);
    const [r1, r2] = await Promise.all([
      claimTask({
        projectsDir: dir,
        projectId: "p",
        role: "writer",
        claimedBy: "worker-A",
      }),
      claimTask({
        projectsDir: dir,
        projectId: "p",
        role: "writer",
        claimedBy: "worker-B",
      }),
    ]);
    const winners = [r1.ok, r2.ok].filter(Boolean).length;
    expect(winners).toBe(1);
  });

  it("does not claim a task in backlog (awaiting approval)", async () => {
    saveProject(dir, makeProject("p"));
    const t = createTaskRecord({
      taskId: "t",
      projectId: "p",
      draft: { ...makeTaskDraft("publisher"), requiresApproval: true },
      origin,
      now: fixedNow,
    });
    saveTask(dir, t);
    const result = await claimTask({
      projectsDir: dir,
      projectId: "p",
      role: "publisher",
      claimedBy: "worker-1",
    });
    expect(result.ok).toBe(false);
  });
});
