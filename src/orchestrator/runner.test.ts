import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAuditLog } from "../security/audit-log.js";
import { runAsOperator } from "../security/origin-context.js";
import { createStubLlmClient } from "./llm-client.js";
import { createRunFromWorkflow } from "./run-state.js";
import { loadRun } from "./run-store.js";
import { runOrchestratorRun } from "./runner.js";
import type { WorkerRegistry } from "./types.js";
import { createDailyResearchWorkers } from "./workers.js";
import {
  DAILY_RESEARCH_WORKFLOW_ID,
  planDailyResearchWorkflow,
} from "./workflows/daily-research.js";

let dir = "";
let auditLogPath = "";
let outputPath = "";

beforeEach(() => {
  dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "alien-orchestrator-runner-"));
  auditLogPath = path.join(dir, "audit.log");
  outputPath = path.join(dir, "brief.md");
});

afterEach(() => {
  fsSync.rmSync(dir, { recursive: true, force: true });
});

function buildWorkers(
  writeFile: (filePath: string, content: string) => Promise<void>,
): WorkerRegistry {
  let researchCounter = 0;
  let writeCounter = 0;
  const llm = createStubLlmClient((req) => {
    if (req.purpose === "researcher") {
      researchCounter += 1;
      return `- bullet ${researchCounter}.a\n- bullet ${researchCounter}.b`;
    }
    if (req.purpose === "writer") {
      writeCounter += 1;
      return `Summary number ${writeCounter}.`;
    }
    if (req.purpose === "editor") {
      return "# Daily Brief\n\nIntro.\n\n## body";
    }
    return "";
  });
  return createDailyResearchWorkers({ llm, writeFile });
}

describe("runOrchestratorRun (daily-research)", () => {
  it("runs every task to success and writes the published file", async () => {
    const writeFile = vi.fn(async (filePath: string, content: string) => {
      fsSync.writeFileSync(filePath, content, "utf8");
    });
    const workers = buildWorkers(writeFile);
    const workflow = planDailyResearchWorkflow({
      runId: "happy",
      topics: ["WebAssembly", "Rust"],
      outputPath,
      title: "Test Brief",
    });
    const run = createRunFromWorkflow({ runId: "happy", workflow });

    const result = await runOrchestratorRun(run, workers, {
      orchestratorDir: dir,
      auditLogPath,
    });

    expect(result.run.status).toBe("succeeded");
    expect(result.tasksAttempted).toBe(workflow.tasks.length);
    for (const task of result.run.tasks) {
      expect(task.status).toBe("succeeded");
    }
    expect(writeFile).toHaveBeenCalledWith(outputPath, expect.stringContaining("# Daily Brief"));
    expect(fsSync.readFileSync(outputPath, "utf8")).toMatch(/# Daily Brief/);
  });

  it("persists the run after every task transition", async () => {
    const writeFile = async () => undefined;
    const workers = buildWorkers(writeFile);
    const workflow = planDailyResearchWorkflow({
      runId: "persisted",
      topics: ["x"],
      outputPath,
    });
    const run = createRunFromWorkflow({ runId: "persisted", workflow });

    await runOrchestratorRun(run, workers, { orchestratorDir: dir });

    const reloaded = loadRun(dir, "persisted");
    expect(reloaded?.status).toBe("succeeded");
    expect(reloaded?.tasks.every((t) => t.status === "succeeded")).toBe(true);
  });

  it("stops when a worker fails and leaves downstream tasks pending", async () => {
    const writeFile = async () => undefined;
    const workers = buildWorkers(writeFile);
    // Override researcher to fail.
    const failingWorkers: WorkerRegistry = {
      ...workers,
      researcher: async () => ({ ok: false, error: "synthetic-research-failure" }),
    };
    const workflow = planDailyResearchWorkflow({
      runId: "fail",
      topics: ["a", "b"],
      outputPath,
    });
    const run = createRunFromWorkflow({ runId: "fail", workflow });

    const result = await runOrchestratorRun(run, failingWorkers, {
      orchestratorDir: dir,
      auditLogPath,
    });

    expect(result.run.status).toBe("failed");
    const research0 = result.run.tasks.find((t) => t.id === "research:0");
    expect(research0?.status).toBe("failed");
    expect(research0?.error).toMatch(/synthetic-research-failure/);
    // Downstream writers / editor / publisher remain pending because their
    // dependency failed; the runner does NOT skip past failures on the MVP.
    const downstream = result.run.tasks.filter((t) =>
      ["write:0", "edit", "publish"].includes(t.id),
    );
    for (const t of downstream) {
      expect(t.status).toBe("pending");
    }
  });

  it("emits chained audit-log entries with origin from currentOrigin (M3)", async () => {
    const writeFile = async () => undefined;
    const workers = buildWorkers(writeFile);
    const workflow = planDailyResearchWorkflow({
      runId: "audit",
      topics: ["x"],
      outputPath,
    });
    const run = createRunFromWorkflow({ runId: "audit", workflow });

    await runAsOperator(() =>
      runOrchestratorRun(run, workers, { orchestratorDir: dir, auditLogPath }),
    );

    const verify = verifyAuditLog(auditLogPath);
    expect(verify.ok).toBe(true);
    if (verify.ok) {
      expect(verify.count).toBeGreaterThan(0);
    }
    const raw = fsSync.readFileSync(auditLogPath, "utf8");
    expect(raw).toMatch(/"kind":"orchestrator\.run\.started"/);
    expect(raw).toMatch(/"kind":"orchestrator\.task\.succeeded"/);
    expect(raw).toMatch(/"kind":"orchestrator\.run\.succeeded"/);
    expect(raw).toMatch(/"origin":"operator"/);
  });

  it("respects an aborted signal between tasks", async () => {
    const writeFile = async () => undefined;
    const workers = buildWorkers(writeFile);
    const workflow = planDailyResearchWorkflow({
      runId: "abort",
      topics: ["x", "y"],
      outputPath,
    });
    const run = createRunFromWorkflow({ runId: "abort", workflow });
    const abortController = new AbortController();
    abortController.abort();

    const result = await runOrchestratorRun(run, workers, {
      orchestratorDir: dir,
      signal: abortController.signal,
    });

    // Aborted before the first task could even start.
    expect(result.tasksAttempted).toBe(0);
    expect(result.run.tasks.every((t) => t.status === "pending")).toBe(true);
  });

  it("workflowId on the run matches the planner constant", async () => {
    const writeFile = async () => undefined;
    const workers = buildWorkers(writeFile);
    const workflow = planDailyResearchWorkflow({
      runId: "id-check",
      topics: ["x"],
      outputPath,
    });
    expect(workflow.id).toBe(DAILY_RESEARCH_WORKFLOW_ID);
    const run = createRunFromWorkflow({ runId: "id-check", workflow });
    await runOrchestratorRun(run, workers, { orchestratorDir: dir });
    const reloaded = loadRun(dir, "id-check");
    expect(reloaded?.workflowId).toBe(DAILY_RESEARCH_WORKFLOW_ID);
  });

  it("planDailyResearchWorkflow throws on empty topics", () => {
    expect(() =>
      planDailyResearchWorkflow({
        runId: "empty",
        topics: [],
        outputPath,
      }),
    ).toThrow(/at least one topic/);
  });

  it("planDailyResearchWorkflow builds the expected dependency shape", () => {
    const wf = planDailyResearchWorkflow({
      runId: "shape",
      topics: ["a", "b", "c"],
      outputPath,
    });
    const ids = wf.tasks.map((t) => t.id);
    expect(ids).toEqual([
      "research:0",
      "research:1",
      "research:2",
      "write:0",
      "write:1",
      "write:2",
      "edit",
      "publish",
    ]);
    const editTask = wf.tasks.find((t) => t.id === "edit");
    expect(editTask?.dependsOn).toEqual(["write:0", "write:1", "write:2"]);
    const publishTask = wf.tasks.find((t) => t.id === "publish");
    expect(publishTask?.dependsOn).toEqual(["edit"]);
  });
});
