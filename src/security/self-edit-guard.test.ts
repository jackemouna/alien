import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkSelfEditGuard, resolveAlienInstallRoot } from "./self-edit-guard.js";

describe("checkSelfEditGuard", () => {
  const installRoot = "/usr/local/lib/node_modules/alien";

  it("allows writes outside the install tree", () => {
    const decision = checkSelfEditGuard("/tmp/foo.txt", { installRoot });
    expect(decision).toEqual({ allowed: true });
  });

  it("refuses writes inside the install tree (deep path)", () => {
    const decision = checkSelfEditGuard(`${installRoot}/src/agents/sandbox/runtime-status.ts`, {
      installRoot,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toMatch(/H2/);
      expect(decision.reason).toMatch(/ALIEN_ALLOW_SELF_EDIT/);
    }
  });

  it("refuses writes targeting package.json at the install root", () => {
    const decision = checkSelfEditGuard(`${installRoot}/package.json`, { installRoot });
    expect(decision.allowed).toBe(false);
  });

  it("refuses writes targeting the install root itself", () => {
    const decision = checkSelfEditGuard(installRoot, { installRoot });
    expect(decision.allowed).toBe(false);
  });

  it("allows writes when ALIEN_ALLOW_SELF_EDIT=1", () => {
    const decision = checkSelfEditGuard(`${installRoot}/src/foo.ts`, {
      installRoot,
      optOutEnvValue: "1",
    });
    expect(decision).toEqual({ allowed: true });
  });

  it("treats values other than '1' as not opting out", () => {
    for (const value of ["true", "yes", "0", "", undefined]) {
      const decision = checkSelfEditGuard(`${installRoot}/src/foo.ts`, {
        installRoot,
        optOutEnvValue: value,
      });
      expect(decision.allowed).toBe(false);
    }
  });

  it("allows writes when installRoot is unknown", () => {
    const decision = checkSelfEditGuard("/anywhere", { installRoot: undefined });
    expect(decision).toEqual({ allowed: true });
  });

  it("does not refuse a sibling directory that happens to share a prefix", () => {
    const decision = checkSelfEditGuard(`${installRoot}-sibling/file.ts`, { installRoot });
    expect(decision).toEqual({ allowed: true });
  });

  it("normalizes path separators (e.g. trailing slashes, .. segments)", () => {
    const sneakyPath = `${installRoot}/../alien/src/agents/sandbox/runtime-status.ts`;
    const decision = checkSelfEditGuard(sneakyPath, { installRoot });
    expect(decision.allowed).toBe(false);
  });

  it("respects symlink-style normalization through path.resolve", () => {
    const decision = checkSelfEditGuard(`${installRoot}/./src/foo.ts`, { installRoot });
    expect(decision.allowed).toBe(false);
  });
});

describe("resolveAlienInstallRoot", () => {
  it("returns the directory of alien.mjs from argv", () => {
    const argv = ["/usr/bin/node", "/opt/alien/alien.mjs", "gateway", "run"];
    expect(resolveAlienInstallRoot(argv)).toBe("/opt/alien");
  });

  it("returns the directory of an alien (no extension) entry point", () => {
    const argv = ["/usr/bin/node", "/usr/local/bin/alien", "gateway"];
    expect(resolveAlienInstallRoot(argv)).toBe("/usr/local/bin");
  });

  it("returns undefined for unrelated entry points (e.g. vitest)", () => {
    expect(resolveAlienInstallRoot(["/usr/bin/node", "/some/path/vitest.mjs"])).toBeUndefined();
  });

  it("returns undefined when argv[1] is missing", () => {
    expect(resolveAlienInstallRoot(["/usr/bin/node"])).toBeUndefined();
  });

  it("resolves relative paths to absolute", () => {
    const argv = ["node", "./alien.mjs"];
    const result = resolveAlienInstallRoot(argv);
    expect(result).toBeDefined();
    expect(path.isAbsolute(result!)).toBe(true);
  });
});
