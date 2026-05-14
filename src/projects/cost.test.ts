import { describe, expect, it } from "vitest";
import type { LlmUsage } from "../orchestrator/llm-client.js";
import {
  estimateCostUsd,
  estimateRoleCostUsd,
  formatCostUsd,
  pricingFor,
  sumProjectCostUsd,
} from "./cost.js";
import { createTaskRecord } from "./task-state.js";
import type { TaskDraft, TaskOrigin, TaskRecord } from "./types.js";

const operatorOrigin: TaskOrigin = { kind: "operator" };
const fixedNow = () => "2026-05-09T12:00:00.000Z";

function makeTask(id: string, costUsd?: number): TaskRecord {
  const draft: TaskDraft = {
    title: "do a thing",
    description: "...",
    role: "writer",
    dependsOn: [],
    input: {},
  };
  const task = createTaskRecord({
    taskId: id,
    projectId: "p",
    draft,
    origin: operatorOrigin,
    now: fixedNow,
  });
  if (typeof costUsd === "number") {
    return { ...task, costUsd };
  }
  return task;
}

describe("pricingFor", () => {
  it("returns Sonnet 4.6 pricing for the known id", () => {
    expect(pricingFor("claude-sonnet-4-6")).toEqual({
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
    });
  });

  it("returns Haiku 4.5 pricing", () => {
    expect(pricingFor("claude-haiku-4-5").inputUsdPerMillion).toBe(1);
    expect(pricingFor("claude-haiku-4-5").outputUsdPerMillion).toBe(5);
  });

  it("falls back to Sonnet 4.6 pricing for unknown models", () => {
    const fallback = pricingFor("some-future-model");
    expect(fallback.inputUsdPerMillion).toBe(3);
    expect(fallback.outputUsdPerMillion).toBe(15);
  });
});

describe("estimateCostUsd", () => {
  it("computes input + output cost from usage", () => {
    const usage: LlmUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      model: "claude-sonnet-4-6",
    };
    // 1000 input * $3/M = $0.003
    // 500 output * $15/M = $0.0075
    // total = $0.0105
    expect(estimateCostUsd(usage)).toBeCloseTo(0.0105, 4);
  });

  it("returns 0 for undefined usage", () => {
    expect(estimateCostUsd(undefined)).toBe(0);
  });

  it("uses the fallback pricing for unknown models", () => {
    const usage: LlmUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      model: "future-model-99",
    };
    expect(estimateCostUsd(usage)).toBeCloseTo(0.0105, 4);
  });

  it("Haiku is cheaper than Sonnet for the same usage", () => {
    const sonnet = estimateCostUsd({
      inputTokens: 1000,
      outputTokens: 500,
      model: "claude-sonnet-4-6",
    });
    const haiku = estimateCostUsd({
      inputTokens: 1000,
      outputTokens: 500,
      model: "claude-haiku-4-5",
    });
    expect(haiku).toBeLessThan(sonnet);
  });
});

describe("estimateRoleCostUsd", () => {
  it("returns 0 for publisher (no LLM call)", () => {
    expect(estimateRoleCostUsd("publisher")).toBe(0);
  });

  it("returns a positive estimate for researcher", () => {
    expect(estimateRoleCostUsd("researcher")).toBeGreaterThan(0);
  });

  it("editor estimate is higher than researcher (more tokens)", () => {
    expect(estimateRoleCostUsd("editor")).toBeGreaterThan(estimateRoleCostUsd("researcher"));
  });
});

describe("sumProjectCostUsd", () => {
  it("sums positive costUsd across done tasks", () => {
    const tasks = [makeTask("a", 0.003), makeTask("b", 0.012), makeTask("c")];
    expect(sumProjectCostUsd(tasks)).toBeCloseTo(0.015, 4);
  });

  it("ignores undefined / non-finite / zero costs", () => {
    const tasks = [makeTask("a"), makeTask("b", 0), makeTask("c", 0.005)];
    expect(sumProjectCostUsd(tasks)).toBeCloseTo(0.005, 4);
  });

  it("returns 0 for an empty list", () => {
    expect(sumProjectCostUsd([])).toBe(0);
  });
});

describe("formatCostUsd", () => {
  it("renders zero as $0.00", () => {
    expect(formatCostUsd(0)).toBe("$0.00");
  });

  it("uses <$0.01 for fractions of a cent", () => {
    expect(formatCostUsd(0.005)).toBe("<$0.01");
  });

  it("renders dollar amounts to two decimals", () => {
    expect(formatCostUsd(1.234)).toBe("$1.23");
  });
});
