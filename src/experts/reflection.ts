import { randomUUID } from "node:crypto";
import type { LlmClient } from "../orchestrator/llm-client.js";
import type { Project, TaskRecord } from "../projects/types.js";
import { listExperts } from "./registry.js";
import {
  appendSoulProposal,
  type SoulProposal,
  type SoulProposalField,
} from "./soul-proposals-store.js";
import type { Expert } from "./types.js";

/**
 * Reflection — the "agent improving itself" loop.
 *
 * Given a project (typically just-completed) + its tasks + a list of
 * experts to consider, asks the model: "what specifically should
 * change about how each expert worked here?" Returns structured
 * proposals, persisted to the soul-proposals store for operator review.
 *
 * Each proposal targets one expert's one field (purpose, tone, role,
 * skills, or the whole soul snippet). Proposals are STRICTLY
 * additive/refinement — the model is told not to rewrite an expert
 * from scratch.
 */

const REFLECTION_SYSTEM_PROMPT = `You are the Reflection Lead inside Alien — an AI workforce of named experts.

Your one job: read the mission that just ran and propose small, specific edits to one or more experts' "soul" (their persona prompt) that would help them do BETTER next time. Reflection should be the kind of feedback a senior teammate would give: concrete, kind, focused on lessons that generalize.

Bias toward:
- Refining "purpose" or "tone" by 1–2 sentences max.
- Adding a single new skill tag if a real capability gap appeared.
- Skipping experts who performed well (no proposal needed — silence is fine).

Avoid:
- Rewriting an expert wholesale.
- Vague edits ("be more helpful").
- More than 3 proposals per reflection.

Respond with ONLY a JSON object on a single line. No prose. Schema:

{"proposals":[
  {"expertId":"<id from the roster>","field":"purpose|tone|role|skills|soul","after":"<full new value for the field>","rationale":"<one short sentence on why>"}
]}

If you have no proposals, return {"proposals":[]}.`;

export type ReflectOptions = {
  readonly llm: LlmClient;
  readonly project: Project;
  readonly tasks: readonly TaskRecord[];
  readonly experts?: readonly Expert[];
};

export async function runReflection(opts: ReflectOptions): Promise<readonly SoulProposal[]> {
  const experts = opts.experts ?? (await listExperts());
  const assignedIds = new Set(
    opts.project.assignedExperts && opts.project.assignedExperts.length > 0
      ? opts.project.assignedExperts
      : experts.map((e) => e.id),
  );
  const considered = experts.filter((e) => assignedIds.has(e.id));
  if (considered.length === 0) return [];

  const completion = await opts.llm.complete({
    system: REFLECTION_SYSTEM_PROMPT,
    user: renderUserPrompt(opts.project, opts.tasks, considered),
    purpose: "reflection",
    maxTokens: 1024,
  });

  const parsed = parseReflectionResponse(completion.text);
  const proposals: SoulProposal[] = [];
  for (const raw of parsed) {
    const expert = considered.find((e) => e.id === raw.expertId);
    if (!expert) continue;
    const before = readExpertField(expert, raw.field);
    if (typeof raw.after !== "string" || raw.after.trim().length === 0) continue;
    if (raw.after.trim() === before.trim()) continue;
    const proposal: SoulProposal = {
      id: `prop-${randomUUID().slice(0, 8)}`,
      expertId: raw.expertId,
      field: raw.field,
      before,
      after: raw.after.trim(),
      rationale: typeof raw.rationale === "string" ? raw.rationale.trim() : "",
      sourceMissionIds: [opts.project.id],
      proposedAt: new Date().toISOString(),
      status: "pending",
      ...(completion.usage?.model ? { model: completion.usage.model } : {}),
    };
    await appendSoulProposal(proposal);
    proposals.push(proposal);
  }
  return proposals;
}

// ---- prompt helpers ----

function renderUserPrompt(
  project: Project,
  tasks: readonly TaskRecord[],
  experts: readonly Expert[],
): string {
  const taskLines = tasks
    .toSorted((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((t) => formatTaskLine(t, experts))
    .join("\n");
  const evalLine = project.goalEvaluation
    ? `Evaluator verdict: ${project.goalEvaluation.status} (confidence ${Math.round(
        (project.goalEvaluation.confidence || 0) * 100,
      )}%) — ${project.goalEvaluation.reason}`
    : "Evaluator verdict: (not yet evaluated)";
  return [
    `Mission: ${project.name}`,
    `Goal: ${project.goal}`,
    `Status: ${project.status}`,
    evalLine,
    `Iterations: ${project.iterationCount ?? 0}`,
    "",
    "Experts on this mission:",
    ...experts.map((e) => `- ${e.id}: ${e.title} — ${e.role}`),
    "",
    tasks.length === 0
      ? "No tasks ran on this mission. Skip reflection unless the goal itself was malformed."
      : `Tasks (oldest first):\n${taskLines}`,
    "",
    "What specifically should change about how each expert worked?",
    "Reply with the JSON {proposals: [...]} only.",
  ].join("\n");
}

function formatTaskLine(t: TaskRecord, experts: readonly Expert[]): string {
  const expert = t.expertId ? experts.find((e) => e.id === t.expertId) : undefined;
  const owner = expert ? `${expert.title}` : t.role;
  const out = t.output !== undefined ? truncate(safeString(t.output), 160) : "";
  const err = t.error ? ` err="${truncate(t.error, 100)}"` : "";
  const tail = out ? ` → ${out}` : "";
  return `- [${t.status}] (${owner}) ${t.title}${err}${tail}`;
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

// ---- parser ----

type RawProposal = {
  readonly expertId: string;
  readonly field: SoulProposalField;
  readonly after: string;
  readonly rationale: string;
};

const KNOWN_FIELDS: ReadonlySet<SoulProposalField> = new Set([
  "purpose",
  "tone",
  "role",
  "skills",
  "soul",
]);

export function parseReflectionResponse(raw: string): readonly RawProposal[] {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const arr = (parsed as { proposals?: unknown }).proposals;
  if (!Array.isArray(arr)) return [];
  const out: RawProposal[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (typeof it.expertId !== "string") continue;
    if (typeof it.field !== "string" || !KNOWN_FIELDS.has(it.field as SoulProposalField)) continue;
    if (typeof it.after !== "string") continue;
    out.push({
      expertId: it.expertId,
      field: it.field as SoulProposalField,
      after: it.after,
      rationale: typeof it.rationale === "string" ? it.rationale : "",
    });
  }
  return out;
}

function readExpertField(expert: Expert, field: SoulProposalField): string {
  if (field === "skills") return expert.skills.join(", ");
  if (field === "soul") {
    return [
      `Title: ${expert.title}`,
      `Role: ${expert.role}`,
      `Purpose: ${expert.purpose}`,
      `Tone: ${expert.tone}`,
      `Skills: ${expert.skills.join(", ")}`,
    ].join("\n");
  }
  return expert[field];
}
