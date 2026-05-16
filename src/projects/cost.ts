import type { LlmUsage } from "../orchestrator/llm-client.js";
import type { WorkerRole } from "../orchestrator/types.js";
import type { TaskRecord } from "./types.js";

/**
 * Pricing + cost estimation utilities. The numbers here are Anthropic's
 * published rates for Claude models, expressed as **USD per million tokens**.
 * If Anthropic adjusts pricing, edit this table — every other cost
 * calculation in the codebase derives from it.
 *
 * Source: https://www.anthropic.com/pricing (verified 2026-05).
 *
 * Unknown model ids fall back to the Sonnet 4.6 rate, intentionally
 * conservative so unfamiliar models don't silently under-bill.
 */

export type ModelPricing = {
  /** USD per 1,000,000 input tokens. */
  readonly inputUsdPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  readonly outputUsdPerMillion: number;
};

const SONNET_46_PRICING: ModelPricing = {
  inputUsdPerMillion: 3,
  outputUsdPerMillion: 15,
};

const HAIKU_45_PRICING: ModelPricing = {
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 5,
};

const OPUS_47_PRICING: ModelPricing = {
  inputUsdPerMillion: 15,
  outputUsdPerMillion: 75,
};

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-sonnet-4-6": SONNET_46_PRICING,
  "claude-sonnet-4-6-20251006": SONNET_46_PRICING,
  "claude-haiku-4-5": HAIKU_45_PRICING,
  "claude-haiku-4-5-20251001": HAIKU_45_PRICING,
  "claude-opus-4-7": OPUS_47_PRICING,
};

const FALLBACK_PRICING = SONNET_46_PRICING;

export function pricingFor(model: string | undefined): ModelPricing {
  if (!model) return FALLBACK_PRICING;
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

/** Compute the USD cost of one LLM call from its reported usage. */
export function estimateCostUsd(usage: LlmUsage | undefined): number {
  if (!usage) return 0;
  const pricing = pricingFor(usage.model);
  const inputCost = (usage.inputTokens * pricing.inputUsdPerMillion) / 1_000_000;
  const outputCost = (usage.outputTokens * pricing.outputUsdPerMillion) / 1_000_000;
  return roundUsd(inputCost + outputCost);
}

/**
 * Heuristic estimate, in USD, of what a task with a given role + model
 * will cost to run. Used by the plan-preview UI to show "this plan will
 * cost ~$0.04" before the user commits.
 *
 * The token counts here are observed averages from real runs — adjust
 * if real-world traffic shifts the distribution.
 */
const ROLE_TOKEN_ESTIMATES: Record<WorkerRole, { input: number; output: number }> = {
  researcher: { input: 320, output: 420 },
  writer: { input: 540, output: 820 },
  editor: { input: 980, output: 1180 },
  publisher: { input: 0, output: 0 }, // no LLM call
  "email-handler": { input: 420, output: 580 },
  // The broker only writes a file + emits an event — no LLM call.
  "capability-broker": { input: 0, output: 0 },
  // Self-coder makes one LLM call that returns full file contents.
  "self-coder": { input: 1200, output: 3000 },
};

export function estimateRoleCostUsd(role: WorkerRole, model?: string): number {
  const tokens = ROLE_TOKEN_ESTIMATES[role];
  if (!tokens || (tokens.input === 0 && tokens.output === 0)) return 0;
  return estimateCostUsd({
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    model: model ?? "claude-sonnet-4-6",
  });
}

/**
 * Sum of costs already recorded on a project's tasks. The pickup loop
 * writes `costUsd` onto each task when its worker completes, so this is
 * the source of truth for "what has this project actually cost."
 */
export function sumProjectCostUsd(tasks: readonly TaskRecord[]): number {
  let total = 0;
  for (const task of tasks) {
    if (typeof task.costUsd === "number" && Number.isFinite(task.costUsd) && task.costUsd > 0) {
      total += task.costUsd;
    }
  }
  return roundUsd(total);
}

/** Cosmetic — display costs as $0.01 down to fractions of a cent. */
export function formatCostUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return "$0.00";
  if (usd < 0.01) return `<$0.01`;
  if (usd < 1) return `$${usd.toFixed(3).replace(/0$/, "")}`;
  return `$${usd.toFixed(2)}`;
}

function roundUsd(value: number): number {
  // Round to 4 decimal places so we can show "$0.001" without losing
  // accuracy across many small accumulations.
  return Math.round(value * 10_000) / 10_000;
}
