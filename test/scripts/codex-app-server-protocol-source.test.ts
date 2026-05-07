import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCodexAppServerProtocolSource } from "../../scripts/lib/codex-app-server-protocol-source.js";
import { createScriptTestHarness } from "./test-helpers.js";

const { createTempDir } = createScriptTestHarness();
const originalAlienCodexRepo = process.env.ALIEN_CODEX_REPO;

afterEach(() => {
  if (originalAlienCodexRepo === undefined) {
    delete process.env.ALIEN_CODEX_REPO;
  } else {
    process.env.ALIEN_CODEX_REPO = originalAlienCodexRepo;
  }
});

describe("codex app-server protocol source resolver", () => {
  it("uses ALIEN_CODEX_REPO when provided", async () => {
    const root = createTempDir("alien-protocol-source-root-");
    const codexRepo = createTempDir("alien-protocol-source-codex-");
    createProtocolSchema(codexRepo);
    process.env.ALIEN_CODEX_REPO = codexRepo;

    await expect(resolveCodexAppServerProtocolSource(root)).resolves.toEqual({
      codexRepo,
      sourceRoot: path.join(codexRepo, "codex-rs/app-server-protocol/schema"),
    });
  });

  it("finds the primary checkout sibling from a git worktree", async () => {
    const parentDir = createTempDir("alien-protocol-source-parent-");
    const primaryAlien = path.join(parentDir, "alien");
    const codexRepo = path.join(parentDir, "codex");
    const worktreeRoot = createTempDir("alien-protocol-source-worktree-");
    fs.mkdirSync(path.join(primaryAlien, ".git", "worktrees", "codex-harness"), {
      recursive: true,
    });
    fs.mkdirSync(worktreeRoot, { recursive: true });
    fs.writeFileSync(
      path.join(worktreeRoot, ".git"),
      `gitdir: ${path.join(primaryAlien, ".git", "worktrees", "codex-harness")}\n`,
    );
    createProtocolSchema(codexRepo);
    delete process.env.ALIEN_CODEX_REPO;

    await expect(resolveCodexAppServerProtocolSource(worktreeRoot)).resolves.toMatchObject({
      codexRepo,
      sourceRoot: path.join(codexRepo, "codex-rs/app-server-protocol/schema"),
    });
  });
});

function createProtocolSchema(codexRepo: string): void {
  fs.mkdirSync(path.join(codexRepo, "codex-rs/app-server-protocol/schema/typescript"), {
    recursive: true,
  });
}
