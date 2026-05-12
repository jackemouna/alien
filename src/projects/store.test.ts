import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteProject,
  deleteTask,
  listProjectIds,
  listTasks,
  loadProject,
  loadTask,
  resolveProjectFile,
  resolveTaskFile,
  saveProject,
  saveTask,
} from "./store.js";
import { createTaskRecord } from "./task-state.js";
import type { Project, TaskDraft, TaskOrigin } from "./types.js";

const origin: TaskOrigin = { kind: "operator" };
const fixedNow = () => "2026-05-09T12:00:00.000Z";

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

function makeDraft(): TaskDraft {
  return {
    title: "do thing",
    description: "...",
    role: "writer",
    dependsOn: [],
    input: { hello: "world" },
  };
}

describe("project + task store", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-projects-store-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("saves + loads + lists projects", () => {
    const p1 = makeProject("alpha");
    const p2 = makeProject("beta");
    saveProject(dir, p1);
    saveProject(dir, p2);
    expect(loadProject(dir, "alpha")).toEqual(p1);
    expect(loadProject(dir, "beta")).toEqual(p2);
    expect(listProjectIds(dir)).toEqual(["alpha", "beta"]);
  });

  it("returns null for unknown project", () => {
    expect(loadProject(dir, "ghost")).toBeNull();
  });

  it("writes project.json with mode 0o600 inside 0o700 dir", () => {
    const p = makeProject("alpha");
    saveProject(dir, p);
    const projectFile = resolveProjectFile(dir, "alpha");
    const projectDir = path.dirname(projectFile);
    expect(fs.statSync(projectFile).mode & 0o777).toBe(0o600);
    expect(fs.statSync(projectDir).mode & 0o777).toBe(0o700);
  });

  it("deletes a project and its tasks", () => {
    const p = makeProject("alpha");
    saveProject(dir, p);
    const t = createTaskRecord({
      taskId: "t-1",
      projectId: "alpha",
      draft: makeDraft(),
      origin,
      now: fixedNow,
    });
    saveTask(dir, t);
    expect(deleteProject(dir, "alpha")).toBe(true);
    expect(loadProject(dir, "alpha")).toBeNull();
    expect(listTasks(dir, "alpha")).toEqual([]);
    expect(deleteProject(dir, "alpha")).toBe(false);
  });

  it("saves + loads + lists tasks", () => {
    saveProject(dir, makeProject("alpha"));
    const t = createTaskRecord({
      taskId: "t-1",
      projectId: "alpha",
      draft: makeDraft(),
      origin,
      now: fixedNow,
    });
    saveTask(dir, t);
    expect(loadTask(dir, "alpha", "t-1")).toEqual(t);
    expect(listTasks(dir, "alpha")).toEqual([t]);
  });

  it("writes task files with mode 0o600 inside 0o700 tasks dir", () => {
    saveProject(dir, makeProject("alpha"));
    const t = createTaskRecord({
      taskId: "t-1",
      projectId: "alpha",
      draft: makeDraft(),
      origin,
      now: fixedNow,
    });
    saveTask(dir, t);
    const taskFile = resolveTaskFile(dir, "alpha", "t-1");
    expect(fs.statSync(taskFile).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(taskFile)).mode & 0o777).toBe(0o700);
  });

  it("deleteTask removes a single task and returns false on second attempt", () => {
    saveProject(dir, makeProject("alpha"));
    const t = createTaskRecord({
      taskId: "t-1",
      projectId: "alpha",
      draft: makeDraft(),
      origin,
      now: fixedNow,
    });
    saveTask(dir, t);
    expect(deleteTask(dir, "alpha", "t-1")).toBe(true);
    expect(loadTask(dir, "alpha", "t-1")).toBeNull();
    expect(deleteTask(dir, "alpha", "t-1")).toBe(false);
  });

  it("rejects ids that could traverse the filesystem", () => {
    const bad = makeProject("../../etc");
    expect(() => saveProject(dir, bad)).toThrow(/Invalid id/);
    const dotty = makeProject(".secret");
    expect(() => saveProject(dir, dotty)).toThrow(/Invalid id/);
  });

  it("treats corrupt project.json as missing", () => {
    saveProject(dir, makeProject("alpha"));
    const projectFile = resolveProjectFile(dir, "alpha");
    fs.writeFileSync(projectFile, "not json", { mode: 0o600 });
    expect(loadProject(dir, "alpha")).toBeNull();
  });

  it("skips non-project subdirectories in listProjectIds", () => {
    fs.mkdirSync(path.join(dir, "not-a-project"), { recursive: true });
    saveProject(dir, makeProject("real"));
    expect(listProjectIds(dir)).toEqual(["real"]);
  });
});
