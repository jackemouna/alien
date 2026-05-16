import type { LlmClient, LlmUsage } from "../orchestrator/llm-client.js";
import { estimateCostUsd } from "./cost.js";
import type { Project, TaskRecord } from "./types.js";

/**
 * The goal-loop evaluator. After every batch of tasks completes, the pickup
 * loop runs the evaluator to decide whether the project's goal is met.
 *
 *   verdict: "achieved"    → loop stops, project transitions to "achieved"
 *   verdict: "needs-more"  → loop re-fires the planner with `feedback`
 *                            and `summary` as priorContext
 *   verdict: "stuck"       → loop stops, project transitions to "needs-input";
 *                            the operator is expected to intervene
 *
 * The evaluator is intentionally model-driven: a deterministic checker can't
 * reason about whether a free-form goal like "research the best AI coach
 * for sleep" is satisfied by the artifacts produced. It does the LLM call
 * itself (not a regular task) so the loop can react without pushing more
 * synthetic work through the worker queue.
 */

export type EvaluatorVerdict = "achieved" | "needs-more" | "stuck";

export type EvaluationOutcome = {
  readonly verdict: EvaluatorVerdict;
  /**
   * Short human-readable explanation. For "achieved" it's the summary the
   * operator sees; for "needs-more" it's the planner's next-round
   * instruction; for "stuck" it's the message to the operator.
   */
  readonly feedback: string;
  /**
   * Compact prose summary of what the prior batches accomplished. Passed
   * back to the planner so it can pivot without re-reading every task.
   */
  readonly priorResultsSummary: string;
  /** USD cost of the evaluation call. */
  readonly costUsd?: number;
};

export type EvaluatorOptions = {
  readonly llm: LlmClient;
  /** Soft cap so a runaway loop can't keep planning forever. */
  readonly maxIterations?: number;
};

const DEFAULT_MAX_ITERATIONS = 5;
const EVALUATOR_MAX_TOKENS = 1024;

export function defaultMaxIterations(): number {
  return DEFAULT_MAX_ITERATIONS;
}

/**
 * Run the evaluator against the current state of a project. Caller is
 * responsible for deciding what to do with the verdict (re-plan, stop,
 * etc.) — `evaluate` only thinks, doesn't act.
 */
export async function evaluate(
  project: Project,
  tasks: readonly TaskRecord[],
  iteration: number,
  opts: EvaluatorOptions,
): Promise<EvaluationOutcome> {
  const completedTasks = tasks.filter((t) => t.status === "done");
  const failedTasks = tasks.filter((t) => t.status === "failed" || t.status === "blocked");
  const reviewTasks = tasks.filter((t) => t.status === "review");

  if (reviewTasks.length > 0) {
    // The loop shouldn't get here if any task is awaiting approval — but if
    // it does, "needs-input" is the safe answer.
    return {
      verdict: "stuck",
      feedback: `${reviewTasks.length} task(s) need operator approval before the loop can continue.`,
      priorResultsSummary: summarizeTasks(completedTasks),
    };
  }

  const max = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (iteration >= max) {
    return {
      verdict: "stuck",
      feedback: `Hit iteration cap of ${max} without reaching the goal. Operator review needed.`,
      priorResultsSummary: summarizeTasks(completedTasks),
    };
  }

  const completedSummary = summarizeTasks(completedTasks);
  const failedSummary = summarizeTasks(failedTasks);

  const system = EVALUATOR_SYSTEM_PROMPT;
  const user = renderEvaluatorPrompt({
    goal: project.goal,
    projectName: project.name,
    iteration,
    completedSummary,
    failedSummary,
  });

  let parsed: { verdict?: string; feedback?: string; summary?: string };
  let usage: LlmUsage | undefined;
  try {
    const completion = await opts.llm.complete({
      system,
      user,
      maxTokens: EVALUATOR_MAX_TOKENS,
      purpose: "evaluator",
    });
    usage = completion.usage;
    parsed = parseEvaluatorResponse(completion.text);
  } catch (err) {
    return {
      verdict: "stuck",
      feedback: `Evaluator failed: ${err instanceof Error ? err.message : String(err)}`,
      priorResultsSummary: completedSummary,
    };
  }

  const verdict = normalizeVerdict(parsed.verdict);
  const feedback = (parsed.feedback ?? "").trim() || defaultFeedbackFor(verdict);
  const priorResultsSummary = (parsed.summary ?? "").trim() || completedSummary;

  return {
    verdict,
    feedback,
    priorResultsSummary,
    ...(usage ? { costUsd: estimateCostUsd(usage) } : {}),
  };
}

function summarizeTasks(tasks: readonly TaskRecord[]): string {
  if (tasks.length === 0) return "(none)";
  return tasks
    .map((t, i) => {
      const outputBlurb = renderOutputBlurb(t.output);
      const head = `${i + 1}. [${t.role}] ${t.title} (${t.status})`;
      return outputBlurb ? `${head}\n   → ${outputBlurb}` : head;
    })
    .join("\n");
}

function renderOutputBlurb(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return truncate(output, 280);
  if (typeof output === "object") {
    // Common shapes: { summary }, { text }, { notes }, { markdown }, { result }
    const obj = output as Record<string, unknown>;
    for (const key of ["summary", "text", "notes", "markdown", "result"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim().length > 0) return truncate(v, 280);
    }
    try {
      return truncate(JSON.stringify(output), 280);
    } catch {
      return "";
    }
  }
  return truncate(String(output), 280);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

const EVALUATOR_SYSTEM_PROMPT = `You are the evaluator for an autonomous AI workforce. Your only job is to decide whether the project's goal has been achieved based on the tasks that have completed so far, and tell the planner what to do next.

You always reply with strict JSON in this exact shape:

{
  "verdict": "achieved" | "needs-more" | "stuck",
  "feedback": "<one paragraph: for achieved, the win; for needs-more, the next instruction to the planner; for stuck, the blocker>",
  "summary": "<short prose summary of what the prior batches accomplished, max 4 sentences>"
}

Pick "achieved" when the artifacts produced clearly satisfy the goal.
Pick "needs-more" when meaningful work remains AND there's a clear next step the planner can take. Be specific in feedback — name the missing piece, don't say "needs more research".
Pick "stuck" when the prior batches failed in a way that another planning round is unlikely to fix without operator intervention (e.g. credentials missing, ambiguous goal, repeated failures of the same kind).

Do not output any commentary outside the JSON object.`;

function renderEvaluatorPrompt(params: {
  goal: string;
  projectName: string;
  iteration: number;
  completedSummary: string;
  failedSummary: string;
}): string {
  return [
    `Project: ${params.projectName}`,
    `Goal: ${params.goal}`,
    `Iteration: ${params.iteration} (0 = initial planning round; each subsequent round is one re-plan)`,
    ``,
    `Completed tasks and their outputs:`,
    params.completedSummary,
    ``,
    `Failed or blocked tasks:`,
    params.failedSummary,
    ``,
    `Decide: verdict + feedback + summary, in the JSON shape from the system prompt.`,
  ].join("\n");
}

type RawEvaluation = {
  verdict?: string;
  feedback?: string;
  summary?: string;
};

function parseEvaluatorResponse(text: string): RawEvaluation {
  const trimmed = text.trim();
  // Strip a code fence if the model added one despite instructions.
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fence?.[1] ?? trimmed;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      return {
        verdict: typeof obj.verdict === "string" ? obj.verdict : undefined,
        feedback: typeof obj.feedback === "string" ? obj.feedback : undefined,
        summary: typeof obj.summary === "string" ? obj.summary : undefined,
      };
    }
  } catch {
    // Fall through to a best-effort regex extraction below.
  }
  // If the model produced prose instead of JSON, treat the whole thing as
  // feedback and assume "needs-more" — safer than failing the loop.
  return { verdict: "needs-more", feedback: body };
}

function normalizeVerdict(input: string | undefined): EvaluatorVerdict {
  const v = (input ?? "").toLowerCase();
  if (v === "achieved") return "achieved";
  if (v === "stuck") return "stuck";
  return "needs-more";
}

function defaultFeedbackFor(verdict: EvaluatorVerdict): string {
  if (verdict === "achieved") return "Goal achieved.";
  if (verdict === "stuck") return "Loop is stuck — operator review needed.";
  return "Plan more work toward the goal.";
}
