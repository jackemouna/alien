import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStubLlmClient } from "../orchestrator/llm-client.js";
import { parsePlannerResponse, persistPlan, plan } from "./planner.js";
import { listTasks, saveProject } from "./store.js";
import type { Project, TaskOrigin } from "./types.js";

const fixedNow = () => "2026-05-09T12:00:00.000Z";
const operatorOrigin: TaskOrigin = { kind: "operator" };

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

const goodPlannerJson = JSON.stringify({
  summary: "Two-step research and write",
  tasks: [
    {
      id: "research-1",
      title: "research topic",
      description: "Gather facts about X.",
      role: "researcher",
      dependsOn: [],
      input: { topic: "X" },
      priority: "normal",
      requiresApproval: false,
    },
    {
      id: "write-1",
      title: "write draft",
      description: "Produce a 200-word brief.",
      role: "writer",
      dependsOn: ["research-1"],
      input: { words: 200 },
      priority: "high",
      requiresApproval: false,
    },
  ],
});

describe("parsePlannerResponse", () => {
  it("parses a well-formed response", () => {
    const result = parsePlannerResponse(goodPlannerJson, 8);
    expect(result.summary).toBe("Two-step research and write");
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]!.role).toBe("researcher");
    expect(result.tasks[1]!.priority).toBe("high");
    expect(result.tasks[1]!.dependsOn).toEqual(["research-1"]);
  });

  it("strips ```json fences if the model adds them", () => {
    const fenced = `\`\`\`json\n${goodPlannerJson}\n\`\`\``;
    const result = parsePlannerResponse(fenced, 8);
    expect(result.tasks).toHaveLength(2);
  });

  it("rejects unknown roles", () => {
    const bad = JSON.stringify({
      tasks: [{ id: "x", title: "t", description: "d", role: "wizard", dependsOn: [], input: {} }],
    });
    expect(() => parsePlannerResponse(bad, 8)).toThrow(/unknown role/);
  });

  it("rejects empty task lists", () => {
    expect(() => parsePlannerResponse(JSON.stringify({ tasks: [] }), 8)).toThrow(/zero tasks/);
  });

  it("rejects more than maxTasks", () => {
    const many = JSON.stringify({
      tasks: Array.from({ length: 4 }, (_, i) => ({
        id: `t-${i}`,
        title: `t${i}`,
        description: "d",
        role: "writer",
        dependsOn: [],
        input: {},
      })),
    });
    expect(() => parsePlannerResponse(many, 2)).toThrow(/4 tasks \(max 2\)/);
  });

  it("rejects duplicate task ids", () => {
    const dup = JSON.stringify({
      tasks: [
        { id: "a", title: "t", description: "d", role: "writer", dependsOn: [], input: {} },
        { id: "a", title: "t2", description: "d", role: "editor", dependsOn: [], input: {} },
      ],
    });
    expect(() => parsePlannerResponse(dup, 8)).toThrow(/duplicate task id/);
  });

  it("defaults missing priority to normal", () => {
    const noPriority = JSON.stringify({
      tasks: [{ id: "a", title: "t", description: "d", role: "writer", dependsOn: [], input: {} }],
    });
    const result = parsePlannerResponse(noPriority, 8);
    expect(result.tasks[0]!.priority).toBe("normal");
  });
});

describe("plan via stub LLM", () => {
  it("threads the system + user prompts through the LLM client", async () => {
    let receivedSystem: string | undefined;
    let receivedUser: string | undefined;
    const stub = createStubLlmClient((req) => {
      receivedSystem = req.system;
      receivedUser = req.user;
      return goodPlannerJson;
    });
    const result = await plan(
      {
        projectId: "p-1",
        prompt: "Write me a brief about WebAssembly.",
        origin: operatorOrigin,
        existing: [],
      },
      { llm: stub },
    );
    expect(result.tasks).toHaveLength(2);
    expect(receivedSystem).toContain("planner agent");
    expect(receivedUser).toContain("WebAssembly");
  });
});

describe("persistPlan", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-projects-planner-"));
    saveProject(dir, makeProject("p-1"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes tasks and remaps dependsOn into the persistent id space", async () => {
    const stub = createStubLlmClient(() => goodPlannerJson);
    const result = await plan(
      { projectId: "p-1", prompt: "x", origin: operatorOrigin, existing: [] },
      { llm: stub },
    );
    const created = persistPlan("p-1", result, {
      projectsDir: dir,
      origin: operatorOrigin,
      idPrefix: "demo",
      now: fixedNow,
    });
    expect(created).toHaveLength(2);
    expect(created[0]!.id).toBe("demo-0");
    expect(created[1]!.id).toBe("demo-1");
    expect(created[1]!.dependsOn).toEqual(["demo-0"]);

    const onDisk = listTasks(dir, "p-1");
    expect(onDisk.map((t) => t.id).toSorted()).toEqual(["demo-0", "demo-1"]);
  });
});
