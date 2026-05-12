import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StarterTemplate } from "./types.js";

/**
 * Loads starter-template JSON files from the repo's `templates/` directory.
 * Resolution walks up from this file's location until it finds a directory
 * containing both `package.json` and `templates/`, mirroring the pattern in
 * `src/infra/control-ui-assets.ts` so the same logic works when running
 * from `src/` and from the bundled `dist/`.
 *
 * Templates are pure data — the loader only validates shape; renderers and
 * the UI gallery decide presentation.
 */

const REPO_WALK_MAX_DEPTH = 8;

export type LoadStarterTemplatesOptions = {
  /** Override the templates directory. Used by tests to point at a fixture. */
  readonly templatesDir?: string;
  readonly fsImpl?: Pick<typeof fs, "readFileSync" | "readdirSync" | "existsSync">;
};

export function loadStarterTemplates(options: LoadStarterTemplatesOptions = {}): StarterTemplate[] {
  const fsImpl = options.fsImpl ?? fs;
  const dir = options.templatesDir ?? resolveTemplatesDir(fsImpl);
  if (!dir || !fsImpl.existsSync(dir)) return [];
  const entries = fsImpl.readdirSync(dir);
  const out: StarterTemplate[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(dir, name);
    try {
      const raw = fsImpl.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const template = validateTemplate(parsed);
      if (template) {
        out.push(template);
      }
    } catch {
      // Bad JSON or invalid template — skip silently. The gallery just
      // won't show this one. A future `alien doctor` check can warn.
    }
  }
  return out.toSorted((a, b) => a.name.localeCompare(b.name));
}

export function resolveTemplatesDir(fsImpl: Pick<typeof fs, "existsSync"> = fs): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < REPO_WALK_MAX_DEPTH; i += 1) {
    const candidate = path.join(dir, "templates");
    if (fsImpl.existsSync(candidate) && fsImpl.existsSync(path.join(dir, "package.json"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function validateTemplate(value: unknown): StarterTemplate | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== "string" ||
    typeof v.name !== "string" ||
    typeof v.tagline !== "string" ||
    typeof v.description !== "string" ||
    typeof v.starterPrompt !== "string" ||
    typeof v.defaultProjectName !== "string" ||
    typeof v.defaultGoal !== "string"
  ) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(v.id)) return null;
  const requires = Array.isArray(v.requires)
    ? v.requires.filter((r): r is string => typeof r === "string")
    : [];
  return {
    id: v.id,
    name: v.name,
    tagline: v.tagline,
    description: v.description,
    starterPrompt: v.starterPrompt,
    defaultProjectName: v.defaultProjectName,
    defaultGoal: v.defaultGoal,
    requires,
    ...(typeof v.icon === "string" ? { icon: v.icon } : {}),
  };
}
