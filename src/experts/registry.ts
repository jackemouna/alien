import { promises as fsp } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logWarn } from "../logger.js";
import { BUNDLED_EXPERTS } from "./builtin/index.js";
import { DEPARTMENT_ORDER } from "./types.js";
import type { Department, Expert, ExpertId } from "./types.js";

/**
 * Loads the bundled experts, merges in any user-defined experts under
 * `~/.alien/experts/*.json`, and exposes a stable id-keyed map.
 *
 * User overrides:
 *   - File name `<id>.json` (id must be kebab-case [a-z0-9-]+).
 *   - Same JSON shape as the Expert type.
 *   - A user file with the same id as a bundled expert completely
 *     replaces the bundled one (the user gets the last word).
 */

let cache: ReadonlyMap<ExpertId, Expert> | undefined;
let cacheStateDir: string | undefined;

export async function listExperts(): Promise<readonly Expert[]> {
  const map = await getExpertsMap();
  // Stable ordering: roster (bundled) first in their declared order, then
  // user-added ones lexicographically.
  const bundledIds = new Set(BUNDLED_EXPERTS.map((e) => e.id));
  const out: Expert[] = [];
  for (const b of BUNDLED_EXPERTS) {
    const eff = map.get(b.id);
    if (eff) out.push(eff);
  }
  const extras = [...map.values()]
    .filter((e) => !bundledIds.has(e.id))
    .toSorted((a, b) => (a.id < b.id ? -1 : 1));
  out.push(...extras);
  return out;
}

export async function getExpert(id: ExpertId): Promise<Expert | undefined> {
  const map = await getExpertsMap();
  return map.get(id);
}

/** For tests + admin endpoints. Does not delete files on disk. */
export function clearExpertCache(): void {
  cache = undefined;
  cacheStateDir = undefined;
}

async function getExpertsMap(): Promise<ReadonlyMap<ExpertId, Expert>> {
  const stateDir = resolveStateDir(process.env);
  if (cache && cacheStateDir === stateDir) return cache;
  const map = new Map<ExpertId, Expert>();
  for (const b of BUNDLED_EXPERTS) map.set(b.id, b);
  const userExperts = await loadUserExperts(path.join(stateDir, "experts"));
  for (const u of userExperts) map.set(u.id, u);
  cache = map;
  cacheStateDir = stateDir;
  return map;
}

async function loadUserExperts(dir: string): Promise<readonly Expert[]> {
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    logWarn(
      `experts.registry: could not read user experts dir ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
  const out: Expert[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) continue;
    try {
      const raw = await fsp.readFile(path.join(dir, name), "utf8");
      const parsed = JSON.parse(raw) as Partial<Expert>;
      const validated = validateExpert({ ...parsed, id });
      if (validated) out.push(validated);
    } catch (err) {
      logWarn(
        `experts.registry: skipping ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return out;
}

const KNOWN_DEPARTMENTS = new Set<Department>(DEPARTMENT_ORDER);

function validateExpert(input: Partial<Expert> & { id: ExpertId }): Expert | undefined {
  if (
    typeof input.id !== "string" ||
    typeof input.name !== "string" ||
    typeof input.title !== "string" ||
    typeof input.role !== "string" ||
    typeof input.purpose !== "string" ||
    typeof input.tone !== "string" ||
    !Array.isArray(input.skills)
  ) {
    return undefined;
  }
  const department: Department =
    typeof input.department === "string" && KNOWN_DEPARTMENTS.has(input.department as Department)
      ? (input.department as Department)
      : "operations";
  return {
    id: input.id,
    name: input.name,
    title: input.title,
    department,
    role: input.role,
    purpose: input.purpose,
    tone: input.tone,
    skills: input.skills.filter((s): s is string => typeof s === "string"),
    ...(Array.isArray(input.toolScope)
      ? { toolScope: input.toolScope.filter((s): s is string => typeof s === "string") }
      : {}),
    ...(input.modelPreference ? { modelPreference: input.modelPreference } : {}),
    ...(typeof input.avatar === "string" ? { avatar: input.avatar } : {}),
  };
}
