import type { LlmClient } from "../orchestrator/llm-client.js";
import type { GoalEvaluation, Project, TaskRecord } from "./types.js";

/**
 * The goal-loop's brain. Given a project's goal + the current state of
 * its task board, asks the model: "is this goal achieved?" and returns
 * a structured GoalEvaluation.
 *
 * Three terminal-ish outputs:
 *   - achieved    → project should flip to status="achieved"
 *   - blocked     → needs operator input, loop pauses
 *   - in-progress → planner should produce the next batch
 *
 * Deliberately small contract. Heavier reasoning lives in the planner
 * itself; the evaluator is a binary judge.
 *
 * The function is pure aside from the LLM call — no fs writes, no audit
 * emits. The caller decides what to do with the verdict.
 */

const EVALUATOR_SYSTEM_PROMPT = `You are the Goal Evaluator inside Alien, an AI workforce of experts working on a long-running mission.

Your one job: given the mission's goal and the current task board, judge whether the goal has been ACHIEVED, is still IN PROGRESS, or is BLOCKED.

Definitions:
- "achieved": the goal as written is satisfied by the completed work. The mission can stop. Be conservative — only return achieved when the evidence is concrete.
- "in-progress": more work is needed and the workforce can keep going on its own. The planner will produce the next batch.
- "blocked": forward progress requires something the workforce cannot do alone — an operator decision, a credential, an external party, an ambiguity in the goal itself, or a capability that doesn't exist yet.

Bias toward "in-progress" when uncertain. Only escalate to "blocked" when there's a concrete, named blocker.

Respond with ONLY a JSON object on a single line, no markdown fence, no preface, no trailing text:

{"status":"achieved|in-progress|blocked","reason":"one short sentence","confidence":0.0to1.0}

Keep "reason" under 200 characters. Confidence is your honest self-assessment.`;

export type EvaluateGoalOptions = {
  readonly llm: LlmClient;
  readonly project: Project;
  readonly tasks: readonly TaskRecord[];
  readonly iteration: number;
  readonly now?: () => string;
};

export async function evaluateGoal(opts: EvaluateGoalOptions): Promise<GoalEvaluation> {
  const now = opts.now ?? (() => new Date().toISOString());
  const userPrompt = renderUserPrompt(opts.project, opts.tasks, opts.iteration);
  const completion = await opts.llm.complete({
    system: EVALUATOR_SYSTEM_PROMPT,
    user: userPrompt,
    purpose: "goal-evaluator",
    maxTokens: 256,
  });
  const parsed = parseEvaluatorResponse(completion.text);
  return {
    status: parsed.status,
    reason: parsed.reason,
    confidence: parsed.confidence,
    evaluatedAt: now(),
    iteration: opts.iteration,
    ...(completion.usage?.model ? { model: completion.usage.model } : {}),
  };
}

// ---- prompt + parser ----

function renderUserPrompt(
  project: Project,
  tasks: readonly TaskRecord[],
  iteration: number,
): string {
  const counts = {
    total: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    inProgress: tasks.filter((t) => t.status === "in-progress").length,
    queued: tasks.filter((t) => t.status === "queued").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
    failed: tasks.filter((t) => t.status === "failed").length,
  };
  const taskLines = tasks
    .toSorted((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((t) => formatTaskLine(t))
    .join("\n");
  return [
    `Mission: ${project.name}`,
    `Goal: ${project.goal}`,
    `Iteration: ${iteration}`,
    "",
    `Task counts — total=${counts.total} done=${counts.done} in-progress=${counts.inProgress} queued=${counts.queued} blocked=${counts.blocked} failed=${counts.failed}`,
    "",
    tasks.length === 0
      ? "No tasks have been emitted yet. The workforce just started — return in-progress."
      : `Tasks (oldest first):\n${taskLines}`,
    "",
    "Reply with the JSON verdict only.",
  ].join("\n");
}

function formatTaskLine(t: TaskRecord): string {
  const out = t.output !== undefined ? truncate(safeString(t.output), 160) : "";
  const err = t.error ? ` err="${truncate(t.error, 100)}"` : "";
  const tail = out ? ` → ${out}` : "";
  return `- [${t.status}] ${t.title}${err}${tail}`;
}

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

type ParsedEvaluation = {
  readonly status: "in-progress" | "achieved" | "blocked";
  readonly reason: string;
  readonly confidence: number;
};

export function parseEvaluatorResponse(raw: string): ParsedEvaluation {
  const trimmed = raw.trim();
  // Tolerate models that wrap the response in fences anyway.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return {
      status: "in-progress",
      reason: `Could not parse evaluator response: ${truncate(trimmed, 120)}`,
      confidence: 0,
    };
  }
  const slice = stripped.slice(firstBrace, lastBrace + 1);
  let json: unknown;
  try {
    json = JSON.parse(slice);
  } catch {
    return {
      status: "in-progress",
      reason: `Evaluator returned malformed JSON: ${truncate(slice, 120)}`,
      confidence: 0,
    };
  }
  if (!json || typeof json !== "object") {
    return { status: "in-progress", reason: "Evaluator returned non-object", confidence: 0 };
  }
  const obj = json as { status?: unknown; reason?: unknown; confidence?: unknown };
  const status = normalizeStatus(obj.status);
  const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
  const confidence = normalizeConfidence(obj.confidence);
  return { status, reason: reason || "(no reason provided)", confidence };
}

function normalizeStatus(v: unknown): ParsedEvaluation["status"] {
  if (v === "achieved" || v === "blocked" || v === "in-progress") return v;
  if (typeof v === "string") {
    const lower = v.toLowerCase();
    if (lower.startsWith("ach")) return "achieved";
    if (lower.startsWith("block")) return "blocked";
  }
  return "in-progress";
}

function normalizeConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
