import { promises as fsp } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/**
 * Phase 4: Soul Proposals — the agent's read on its own behavior.
 *
 * After a mission lands, a Reflection job (src/experts/reflection.ts)
 * asks the model to look at what happened (audit log, task outcomes,
 * goal evaluation verdict) and propose edits to one or more experts'
 * souls. Each proposal is persisted here as a structured record the
 * operator can review on /soul-proposals.
 *
 * The store is one append-mostly JSON file at
 * `${state-dir}/soul-proposals.json`. Status transitions are mutating
 * updates — we read all, replace one, write all back. Volume is low
 * (~10s/day at most) so this is fine.
 */

export type SoulProposalStatus = "pending" | "applied" | "rejected" | "snoozed";

/**
 * Which expert field a proposal wants to edit. `soul` means a freeform
 * patch to the whole soul snippet (rendered as Markdown for review);
 * the others target individual fields on the Expert record.
 */
export type SoulProposalField = "purpose" | "tone" | "role" | "skills" | "soul";

export type SoulProposal = {
  readonly id: string;
  /** Expert id from the registry (e.g. "engineering-lead"). */
  readonly expertId: string;
  readonly field: SoulProposalField;
  /** What the field looked like at proposal time (for diff). */
  readonly before: string;
  /** What the reflector wants the field to become. */
  readonly after: string;
  /** Plain-English why-this-matters from the reflector. */
  readonly rationale: string;
  /** Mission ids that informed this proposal. */
  readonly sourceMissionIds: readonly string[];
  /** ISO-8601 — when the reflector wrote this. */
  readonly proposedAt: string;
  status: SoulProposalStatus;
  reviewedAt?: string;
  reviewerNote?: string;
  /** Model id that produced the reflection (for diagnostics). */
  readonly model?: string;
};

type SoulProposalsFile = {
  readonly version: 1;
  readonly proposals: SoulProposal[];
};

const FILE_NAME = "soul-proposals.json";

export function resolveSoulProposalsPath(): string {
  return path.join(resolveStateDir(), FILE_NAME);
}

export async function readSoulProposals(): Promise<readonly SoulProposal[]> {
  try {
    const raw = await fsp.readFile(resolveSoulProposalsPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { version?: number }).version === 1 &&
      Array.isArray((parsed as { proposals?: unknown }).proposals)
    ) {
      return (parsed as SoulProposalsFile).proposals;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return [];
}

export async function appendSoulProposal(proposal: SoulProposal): Promise<void> {
  const existing = await readSoulProposals();
  const next = [...existing, proposal];
  await writeAll(next);
}

export async function updateSoulProposalStatus(
  id: string,
  patch: { status: SoulProposalStatus; reviewerNote?: string; reviewedAt?: string },
): Promise<SoulProposal | undefined> {
  const existing = await readSoulProposals();
  let updated: SoulProposal | undefined;
  const next = existing.map((p) => {
    if (p.id !== id) return p;
    updated = {
      ...p,
      status: patch.status,
      ...(patch.reviewerNote ? { reviewerNote: patch.reviewerNote } : {}),
      reviewedAt: patch.reviewedAt ?? new Date().toISOString(),
    };
    return updated;
  });
  if (!updated) return undefined;
  await writeAll(next);
  return updated;
}

async function writeAll(proposals: readonly SoulProposal[]): Promise<void> {
  const filePath = resolveSoulProposalsPath();
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const file: SoulProposalsFile = { version: 1, proposals: [...proposals] };
  await fsp.writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fsp.chmod(filePath, 0o600).catch(() => {});
}
