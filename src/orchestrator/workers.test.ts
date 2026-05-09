import { describe, expect, it, vi } from "vitest";
import { createStubLlmClient, type LlmCompletionRequest } from "./llm-client.js";
import type { TaskRecord, WorkerInput } from "./types.js";
import { createDailyResearchWorkers } from "./workers.js";

function makeInput(params: {
  taskRole: TaskRecord["role"];
  taskInput: Record<string, unknown>;
  dependencyOutputs?: Record<string, unknown>;
}): WorkerInput {
  const task: TaskRecord = {
    id: `${params.taskRole}-1`,
    role: params.taskRole,
    summary: params.taskRole,
    input: params.taskInput,
    dependsOn: [],
    status: "running",
    attempts: 1,
  };
  return {
    task,
    dependencyOutputs: params.dependencyOutputs ?? {},
    run: { id: "r-1", workflowId: "test", metadata: {} },
  };
}

describe("researcher", () => {
  it("returns ok with notes when llm responds", async () => {
    const recorded: LlmCompletionRequest[] = [];
    const llm = createStubLlmClient((req) => {
      recorded.push(req);
      return "- point one\n- point two";
    });
    const workers = createDailyResearchWorkers({ llm });
    const result = await workers.researcher(
      makeInput({ taskRole: "researcher", taskInput: { topic: "WebAssembly" } }),
    );
    expect(result.ok).toBe(true);
    expect((result.result as { topic: string; notes: string }).topic).toBe("WebAssembly");
    expect((result.result as { notes: string }).notes).toMatch(/point one/);
    expect(recorded[0]?.purpose).toBe("researcher");
    expect(recorded[0]?.user).toBe("WebAssembly");
  });

  it("fails on missing topic", async () => {
    const llm = createStubLlmClient(() => "should-not-be-called");
    const workers = createDailyResearchWorkers({ llm });
    const result = await workers.researcher(makeInput({ taskRole: "researcher", taskInput: {} }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/topic/);
  });

  it("fails when the llm throws", async () => {
    const llm = createStubLlmClient(() => {
      throw new Error("rate limit");
    });
    const workers = createDailyResearchWorkers({ llm });
    const result = await workers.researcher(
      makeInput({ taskRole: "researcher", taskInput: { topic: "x" } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rate limit/);
  });
});

describe("writer", () => {
  it("uses upstream research notes and returns a summary", async () => {
    const recorded: LlmCompletionRequest[] = [];
    const llm = createStubLlmClient((req) => {
      recorded.push(req);
      return "A polished 100-word summary about WebAssembly.";
    });
    const workers = createDailyResearchWorkers({ llm });
    const result = await workers.writer(
      makeInput({
        taskRole: "writer",
        taskInput: { topic: "WebAssembly", wordTarget: 100 },
        dependencyOutputs: {
          "researcher-1": { topic: "WebAssembly", notes: "- key facts" },
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect((result.result as { summary: string }).summary).toMatch(/polished/);
    expect(recorded[0]?.user).toMatch(/Topic: WebAssembly/);
    expect(recorded[0]?.user).toMatch(/key facts/);
  });

  it("fails when no research notes are present", async () => {
    const llm = createStubLlmClient(() => "");
    const workers = createDailyResearchWorkers({ llm });
    const result = await workers.writer(
      makeInput({ taskRole: "writer", taskInput: { topic: "x" } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/research/);
  });
});

describe("editor", () => {
  it("combines multiple writer outputs and returns markdown", async () => {
    const recorded: LlmCompletionRequest[] = [];
    const llm = createStubLlmClient((req) => {
      recorded.push(req);
      return "# Daily Brief\n\nIntro.\n\n## Wasm\n\nedited wasm.";
    });
    const workers = createDailyResearchWorkers({ llm });
    const result = await workers.editor(
      makeInput({
        taskRole: "editor",
        taskInput: { title: "Daily Brief" },
        dependencyOutputs: {
          "writer-1": { topic: "Wasm", summary: "draft wasm." },
          "writer-2": { topic: "Rust", summary: "draft rust." },
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect((result.result as { markdown: string }).markdown).toMatch(/# Daily Brief/);
    expect(recorded[0]?.user).toMatch(/## Wasm/);
    expect(recorded[0]?.user).toMatch(/## Rust/);
  });

  it("fails when there are no writer outputs", async () => {
    const llm = createStubLlmClient(() => "");
    const workers = createDailyResearchWorkers({ llm });
    const result = await workers.editor(
      makeInput({ taskRole: "editor", taskInput: { title: "x" } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/writer/);
  });
});

describe("publisher", () => {
  it("writes the editor output to disk", async () => {
    const writeFile = vi.fn(async () => undefined);
    const llm = createStubLlmClient(() => "");
    const workers = createDailyResearchWorkers({ llm, writeFile });
    const result = await workers.publisher(
      makeInput({
        taskRole: "publisher",
        taskInput: { outputPath: "/tmp/brief.md" },
        dependencyOutputs: {
          "editor-1": { markdown: "# Daily Brief\n\nbody." },
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith("/tmp/brief.md", "# Daily Brief\n\nbody.");
    const out = result.result as { path: string; bytes: number };
    expect(out.path).toBe("/tmp/brief.md");
    expect(out.bytes).toBeGreaterThan(0);
  });

  it("fails when no editor output is present", async () => {
    const llm = createStubLlmClient(() => "");
    const workers = createDailyResearchWorkers({ llm, writeFile: vi.fn() });
    const result = await workers.publisher(
      makeInput({ taskRole: "publisher", taskInput: { outputPath: "/tmp/x.md" } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/editor/);
  });

  it("fails when outputPath is missing", async () => {
    const llm = createStubLlmClient(() => "");
    const workers = createDailyResearchWorkers({ llm, writeFile: vi.fn() });
    const result = await workers.publisher(
      makeInput({
        taskRole: "publisher",
        taskInput: {},
        dependencyOutputs: { "editor-1": { markdown: "x" } },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/outputPath/);
  });

  it("propagates writeFile failures", async () => {
    const writeFile = vi.fn(async () => {
      throw new Error("disk full");
    });
    const llm = createStubLlmClient(() => "");
    const workers = createDailyResearchWorkers({ llm, writeFile });
    const result = await workers.publisher(
      makeInput({
        taskRole: "publisher",
        taskInput: { outputPath: "/tmp/x.md" },
        dependencyOutputs: { "editor-1": { markdown: "x" } },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/disk full/);
  });
});
