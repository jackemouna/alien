import { promises as fsp } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { clearExpertCache, getExpert } from "./registry.js";
import type { SoulProposal } from "./soul-proposals-store.js";
import type { Expert } from "./types.js";

/**
 * Apply an approved soul proposal by writing a user-defined expert
 * override at `${state-dir}/experts/<id>.json`. The registry already
 * supports user overrides — a file with the same id as a bundled
 * expert wins.
 *
 * We load the current effective expert (bundled or already-overridden),
 * mutate the one field the proposal targets, write the full Expert
 * shape back, and bust the registry cache so the next read sees the
 * change.
 *
 * `skills` is split on commas (mirrors how the reflector formats them
 * back). `soul` is the freeform "whole soul" patch — we look for the
 * known field labels (Role/Purpose/Tone/Skills) and overwrite them
 * inline; anything we can't match falls into purpose as a safe default
 * so no edit gets lost.
 */

export async function applySoulProposal(proposal: SoulProposal): Promise<Expert> {
  const current = await getExpert(proposal.expertId);
  if (!current) {
    throw new Error(`apply-proposal: unknown expert id: ${proposal.expertId}`);
  }
  const next: Expert = mergeFieldEdit(current, proposal);
  const dir = path.join(resolveStateDir(process.env), "experts");
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${proposal.expertId}.json`);
  await fsp.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fsp.chmod(filePath, 0o600).catch(() => {});
  // Invalidate the registry cache so the next read sees the override.
  clearExpertCache();
  return next;
}

function mergeFieldEdit(current: Expert, proposal: SoulProposal): Expert {
  switch (proposal.field) {
    case "purpose":
      return { ...current, purpose: proposal.after };
    case "tone":
      return { ...current, tone: proposal.after };
    case "role":
      return { ...current, role: proposal.after };
    case "skills":
      return {
        ...current,
        skills: proposal.after
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      };
    case "soul":
      return applySoulPatch(current, proposal.after);
  }
}

function applySoulPatch(current: Expert, soul: string): Expert {
  const role = extract(soul, "Role") ?? current.role;
  const purpose = extract(soul, "Purpose") ?? current.purpose;
  const tone = extract(soul, "Tone") ?? current.tone;
  const skillsStr = extract(soul, "Skills");
  const skills = skillsStr
    ? skillsStr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [...current.skills];
  return { ...current, role, purpose, tone, skills };
}

function extract(text: string, label: string): string | undefined {
  const re = new RegExp(`${label}\\s*:\\s*([^\\n]+)`, "i");
  const m = text.match(re);
  return m ? m[1]?.trim() : undefined;
}
