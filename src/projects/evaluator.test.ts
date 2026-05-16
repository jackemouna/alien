import { describe, expect, it } from "vitest";
import { createStubLlmClient } from "../orchestrator/llm-client.js";
import { evaluate } from "./evaluator.js";
import { createTaskRecord } from "./task-state.js";
import { markTaskDone, markTaskFailed } from "./task-state.js";
import type { Project, TaskDraft, TaskOrigin, TaskRecord } from "./types.js";

const operatorOrigin: TaskOrigin = { kind: "operator" };
const fixedNow = () => "2026-05-15T12:00:00.000Z";

function makeProject(goal: string): Project {
  return {
    id: "p-1",
    name: "Project",
    goal,
    owner: "tester",
    createdAt: fixedNow(),
    status: "active",
    channels: [],
  };
}

function makeDone(id: string, output: unknown): TaskRecord {
  const draft: TaskDraft = {
    title: "t",
    description: "d",
    role: "writer",
    dependsOn: [],
    input: {},
  };
  const task = createTaskRecord({
    taskId: id,
    projectId: "p-1",
    draft,
    origin: operatorOrigin,
    now: fixedNow,
  });
  return markTaskDone(task, output, fixedNow);
}

describe("evaluator", () => {
  it("returns 'stuck' when iteration cap is hit before calling the LLM", async () => {
    let calls = 0;
    const llm = createStubLlmClient(() => {
      calls += 1;
      return "{}";
    });
    const project = makeProject("Write a poem");
    const tasks = [makeDone("a", "draft")];
    const outcome = await evaluate(project, tasks, 5, { llm, maxIterations: 5 });
    expect(outcome.verdict).toBe("stuck");
    expect(outcome.feedback).toMatch(/iteration cap/i);
    expect(calls).toBe(0);
  });

  it("returns 'stuck' when a task is awaiting operator approval", async () => {
    const llm = createStubLlmClient(() => "{}");
    const project = makeProject("Write a poem");
    const task = createTaskRecord({
      taskId: "a",
      projectId: "p-1",
      draft: { title: "t", description: "d", role: "writer", dependsOn: [], input: {} },
      origin: operatorOrigin,
      now: fixedNow,
    });
    const reviewTask: TaskRecord = { ...task, status: "review" };
    const outcome = await evaluate(project, [reviewTask], 0, { llm });
    expect(outcome.verdict).toBe("stuck");
    expect(outcome.feedback).toMatch(/operator approval/i);
  });

  it("parses 'achieved' verdict from a JSON response", async () => {
    const llm = createStubLlmClient(() =>
      JSON.stringify({
        verdict: "achieved",
        feedback: "All done.",
        summary: "Wrote the poem.",
      }),
    );
    const outcome = await evaluate(makeProject("Write a poem"), [makeDone("a", "poem")], 0, {
      llm,
    });
    expect(outcome.verdict).toBe("achieved");
    expect(outcome.feedback).toBe("All done.");
    expect(outcome.priorResultsSummary).toBe("Wrote the poem.");
  });

  it("parses 'needs-more' verdict and exposes feedback to the planner", async () => {
    const llm = createStubLlmClient(() =>
      JSON.stringify({
        verdict: "needs-more",
        feedback: "Poem is missing a third stanza about love.",
        summary: "Two-stanza draft exists.",
      }),
    );
    const outcome = await evaluate(makeProject("Write a 3-stanza poem"), [makeDone("a", "x")], 0, {
      llm,
    });
    expect(outcome.verdict).toBe("needs-more");
    expect(outcome.feedback).toMatch(/third stanza/);
  });

  it("falls back to 'needs-more' for non-JSON model responses", async () => {
    const llm = createStubLlmClient(
      () => "I think we should write another paragraph about the topic.",
    );
    const outcome = await evaluate(makeProject("Write a poem"), [makeDone("a", "x")], 0, { llm });
    expect(outcome.verdict).toBe("needs-more");
    expect(outcome.feedback).toMatch(/another paragraph/);
  });

  it("tolerates code-fenced JSON the model wraps despite instructions", async () => {
    const llm = createStubLlmClient(
      () => `\`\`\`json
${JSON.stringify({ verdict: "achieved", feedback: "yes", summary: "" })}
\`\`\``,
    );
    const outcome = await evaluate(makeProject("g"), [makeDone("a", "x")], 0, { llm });
    expect(outcome.verdict).toBe("achieved");
  });

  it("reports 'stuck' when the LLM call throws", async () => {
    const llm = createStubLlmClient(() => {
      throw new Error("API down");
    });
    const outcome = await evaluate(makeProject("g"), [makeDone("a", "x")], 0, { llm });
    expect(outcome.verdict).toBe("stuck");
    expect(outcome.feedback).toMatch(/API down/);
  });

  it("includes failed tasks in the summary handed back to the planner", async () => {
    const task = createTaskRecord({
      taskId: "f",
      projectId: "p-1",
      draft: { title: "broken", description: "d", role: "writer", dependsOn: [], input: {} },
      origin: operatorOrigin,
      now: fixedNow,
    });
    const failed = markTaskFailed(task, "boom", fixedNow);
    let receivedUser = "";
    const llm = createStubLlmClient((req) => {
      receivedUser = req.user;
      return JSON.stringify({ verdict: "stuck", feedback: "all failed", summary: "" });
    });
    await evaluate(makeProject("g"), [failed], 0, { llm });
    expect(receivedUser).toMatch(/broken/);
    expect(receivedUser).toMatch(/Failed or blocked/);
  });
});
