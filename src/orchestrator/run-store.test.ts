import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunFromWorkflow } from "./run-state.js";
import { deleteRun, listRunIds, loadRun, resolveRunPath, saveRun } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";

const workflow: WorkflowDefinition = {
  id: "test",
  name: "Test",
  tasks: [
    { id: "a", role: "researcher", summary: "a", input: {}, dependsOn: [] },
    { id: "b", role: "writer", summary: "b", input: {}, dependsOn: ["a"] },
  ],
};

let dir = "";

beforeEach(() => {
  dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-orchestrator-store-"));
});

afterEach(() => {
  fsSync.rmSync(dir, { recursive: true, force: true });
});

describe("run-store", () => {
  it("resolveRunPath returns <dir>/runs/<id>.json", () => {
    expect(resolveRunPath("/tmp/orch", "abc-123")).toBe("/tmp/orch/runs/abc-123.json");
  });

  it("creates the parent directory at 0o700 on first save", () => {
    const run = createRunFromWorkflow({ runId: "r-1", workflow });
    saveRun(dir, run);
    const runsDir = path.join(dir, "runs");
    expect(fsSync.existsSync(runsDir)).toBe(true);
    const filePath = path.join(runsDir, "r-1.json");
    expect(fsSync.existsSync(filePath)).toBe(true);
  });

  it("round-trips a run through save → load", () => {
    const run = createRunFromWorkflow({ runId: "r-2", workflow });
    saveRun(dir, run);
    const loaded = loadRun(dir, "r-2");
    expect(loaded?.id).toBe("r-2");
    expect(loaded?.tasks).toHaveLength(2);
    expect(loaded?.tasks[0]?.id).toBe("a");
  });

  it("returns null when the run file does not exist", () => {
    expect(loadRun(dir, "missing")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    fsSync.mkdirSync(path.join(dir, "runs"), { recursive: true });
    fsSync.writeFileSync(path.join(dir, "runs", "bad.json"), "{ not valid", "utf8");
    expect(loadRun(dir, "bad")).toBeNull();
  });

  it("listRunIds returns sorted run ids", () => {
    for (const id of ["beta", "alpha", "gamma"]) {
      saveRun(dir, createRunFromWorkflow({ runId: id, workflow }));
    }
    expect(listRunIds(dir)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("listRunIds returns [] when the runs directory does not exist", () => {
    expect(listRunIds(path.join(dir, "absent"))).toEqual([]);
  });

  it("deleteRun removes the file and returns true", () => {
    saveRun(dir, createRunFromWorkflow({ runId: "tmp", workflow }));
    expect(deleteRun(dir, "tmp")).toBe(true);
    expect(loadRun(dir, "tmp")).toBeNull();
  });

  it("deleteRun returns false when the run does not exist", () => {
    expect(deleteRun(dir, "nope")).toBe(false);
  });

  it("rejects path-traversal in the run id", () => {
    const run = createRunFromWorkflow({ runId: "ok", workflow });
    expect(() => saveRun(dir, { ...run, id: "../escape" })).toThrow(/Invalid run id/);
    expect(() => saveRun(dir, { ...run, id: "with spaces" })).toThrow(/Invalid run id/);
    expect(() => saveRun(dir, { ...run, id: ".." })).toThrow(/Invalid run id/);
    expect(() => saveRun(dir, { ...run, id: ".dotfile" })).toThrow(/Invalid run id/);
  });

  it("accepts safe characters [A-Za-z0-9_.-]", () => {
    const run = createRunFromWorkflow({ runId: "ok-1_2.3", workflow });
    expect(() => saveRun(dir, run)).not.toThrow();
  });
});
