import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadStarterTemplates } from "./loader.js";

describe("loadStarterTemplates", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "alien-templates-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads valid JSON templates and sorts by name", () => {
    write(dir, "b.json", {
      id: "bee",
      name: "Bee",
      tagline: "buzz",
      description: "...",
      starterPrompt: "do bee things",
      defaultProjectName: "Bee project",
      defaultGoal: "make honey",
      requires: [],
    });
    write(dir, "a.json", {
      id: "ant",
      name: "Ant",
      tagline: "march",
      description: "...",
      starterPrompt: "do ant things",
      defaultProjectName: "Ant project",
      defaultGoal: "haul crumbs",
      requires: ["gmail"],
    });
    const result = loadStarterTemplates({ templatesDir: dir });
    expect(result.map((t) => t.id)).toEqual(["ant", "bee"]);
    expect(result[0]!.requires).toEqual(["gmail"]);
  });

  it("skips invalid JSON without throwing", () => {
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not valid", { mode: 0o600 });
    write(dir, "good.json", validTemplate("ok"));
    const result = loadStarterTemplates({ templatesDir: dir });
    expect(result.map((t) => t.id)).toEqual(["ok"]);
  });

  it("rejects templates with unsafe ids", () => {
    write(dir, "bad.json", { ...validTemplate("ok"), id: "../escape" });
    expect(loadStarterTemplates({ templatesDir: dir })).toEqual([]);
  });

  it("returns empty when the directory is missing", () => {
    expect(loadStarterTemplates({ templatesDir: path.join(dir, "nope") })).toEqual([]);
  });

  it("ignores non-JSON files", () => {
    fs.writeFileSync(path.join(dir, "readme.md"), "# templates", { mode: 0o600 });
    write(dir, "good.json", validTemplate("good"));
    const result = loadStarterTemplates({ templatesDir: dir });
    expect(result).toHaveLength(1);
  });

  it("preserves the optional icon when present", () => {
    write(dir, "iconed.json", { ...validTemplate("iconed"), icon: "🍪" });
    const result = loadStarterTemplates({ templatesDir: dir });
    expect(result[0]!.icon).toBe("🍪");
  });
});

function write(dir: string, name: string, body: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(body), { mode: 0o600 });
}

function validTemplate(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    tagline: "...",
    description: "...",
    starterPrompt: "...",
    defaultProjectName: id,
    defaultGoal: "...",
    requires: [],
  };
}
