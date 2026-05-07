import fs from "node:fs/promises";
import path from "node:path";
import {
  replaceManagedMarkdownBlock,
  withTrailingNewline,
} from "alien/plugin-sdk/memory-host-markdown";
import { FsSafeError, pathExists, root as fsRoot } from "alien/plugin-sdk/security-runtime";
import type { ResolvedMemoryWikiConfig } from "./config.js";
import { appendMemoryWikiLog } from "./log.js";

export const WIKI_VAULT_DIRECTORIES = [
  "entities",
  "concepts",
  "syntheses",
  "sources",
  "reports",
  "_attachments",
  "_views",
  ".alien-wiki",
  ".alien-wiki/locks",
  ".alien-wiki/cache",
] as const;

type InitializeMemoryWikiVaultResult = {
  rootDir: string;
  created: boolean;
  createdDirectories: string[];
  createdFiles: string[];
};

function buildIndexMarkdown(): string {
  return withTrailingNewline(
    replaceManagedMarkdownBlock({
      original: "# Wiki Index\n",
      heading: "## Generated",
      startMarker: "<!-- alien:wiki:index:start -->",
      endMarker: "<!-- alien:wiki:index:end -->",
      body: "- No compiled pages yet.",
    }),
  );
}

function buildAgentsMarkdown(): string {
  return withTrailingNewline(`\
# Memory Wiki Agent Guide

- Treat generated blocks as plugin-owned.
- Preserve human notes outside managed markers.
- Prefer source-backed claims over wiki-to-wiki citation loops.
- Prefer structured \`claims\` with evidence over burying key beliefs only in prose.
- Use \`.alien-wiki/cache/agent-digest.json\` and \`claims.jsonl\` for machine reads; markdown pages are the human view.
`);
}

function buildWikiOverviewMarkdown(config: ResolvedMemoryWikiConfig): string {
  return withTrailingNewline(`\
# Memory Wiki

This vault is maintained by the Alien memory-wiki plugin.

- Vault mode: \`${config.vaultMode}\`
- Render mode: \`${config.vault.renderMode}\`
- Search corpus default: \`${config.search.corpus}\`

## Architecture
- Raw sources remain the evidence layer.
- Wiki pages are the human-readable synthesis layer.
- \`.alien-wiki/cache/agent-digest.json\` is the agent-facing compiled digest.

## Notes
<!-- alien:human:start -->
<!-- alien:human:end -->
`);
}

async function writeFileIfMissing(
  rootDir: string,
  relativePath: string,
  content: string,
  createdFiles: string[],
): Promise<void> {
  const root = await fsRoot(rootDir);
  try {
    await root.create(relativePath, content);
  } catch (err) {
    if (err instanceof FsSafeError && err.code === "already-exists") {
      return;
    }
    throw err;
  }
  createdFiles.push(path.join(rootDir, relativePath));
}

export async function initializeMemoryWikiVault(
  config: ResolvedMemoryWikiConfig,
  options?: { nowMs?: number },
): Promise<InitializeMemoryWikiVaultResult> {
  const rootDir = config.vault.path;
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];

  if (!(await pathExists(rootDir))) {
    createdDirectories.push(rootDir);
  }
  await fs.mkdir(rootDir, { recursive: true });

  for (const relativeDir of WIKI_VAULT_DIRECTORIES) {
    const fullPath = path.join(rootDir, relativeDir);
    if (!(await pathExists(fullPath))) {
      createdDirectories.push(fullPath);
    }
    await fs.mkdir(fullPath, { recursive: true });
  }

  await writeFileIfMissing(rootDir, "AGENTS.md", buildAgentsMarkdown(), createdFiles);
  await writeFileIfMissing(rootDir, "WIKI.md", buildWikiOverviewMarkdown(config), createdFiles);
  await writeFileIfMissing(rootDir, "index.md", buildIndexMarkdown(), createdFiles);
  await writeFileIfMissing(
    rootDir,
    "inbox.md",
    withTrailingNewline("# Inbox\n\nDrop raw ideas, questions, and source links here.\n"),
    createdFiles,
  );
  await writeFileIfMissing(
    rootDir,
    ".alien-wiki/state.json",
    withTrailingNewline(
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date(options?.nowMs ?? Date.now()).toISOString(),
          renderMode: config.vault.renderMode,
        },
        null,
        2,
      ),
    ),
    createdFiles,
  );
  await writeFileIfMissing(rootDir, ".alien-wiki/log.jsonl", "", createdFiles);

  if (createdDirectories.length > 0 || createdFiles.length > 0) {
    await appendMemoryWikiLog(rootDir, {
      type: "init",
      timestamp: new Date(options?.nowMs ?? Date.now()).toISOString(),
      details: {
        createdDirectories: createdDirectories.map((dir) => path.relative(rootDir, dir) || "."),
        createdFiles: createdFiles.map((file) => path.relative(rootDir, file)),
      },
    });
  }

  return {
    rootDir,
    created: createdDirectories.length > 0 || createdFiles.length > 0,
    createdDirectories,
    createdFiles,
  };
}
