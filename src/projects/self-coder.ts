import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { LlmClient, LlmUsage } from "../orchestrator/llm-client.js";
import { emitProjectsAuditEvent } from "./audit.js";
import {
  readCapabilityRequests,
  resolveCapabilityRequestsPath,
} from "./capability-requests-store.js";
import { estimateCostUsd } from "./cost.js";
import type { ProjectWorker, ProjectWorkerOutput } from "./pickup-loop.js";

/**
 * Self-coder worker (Phase C). Reads an open capability request and asks
 * the LLM to generate a minimal extension scaffold:
 *
 *   - index.ts   — entry point with createCapability(deps) factory
 *   - types.ts   — input + output types matching the sketch
 *   - README.md  — what was generated, why, and how to extend it
 *
 * Output goes into `<workspace-root>/extensions/.generated/<integration>/`.
 * The .generated directory is sandboxed by convention: nothing in
 * `src/` imports from it, and the runtime loader does not pick it up.
 * Operator review is the gate before activation. (Phase D will load
 * approved generated extensions; Phase E adds rollback + reasoning trace.)
 *
 * Task input shape:
 *   { "requestId": "cap-..." }   ← references a capability request
 *
 * On success the request status is bumped from "open" to "fulfilled"
 * (or "in-progress" if the operator wants to iterate before approval —
 * v0.1 just sets "fulfilled" since the worker doesn't iterate).
 */

export type SelfCoderOptions = {
  readonly llm: LlmClient;
  /** Audit log path. */
  readonly auditLogPath?: string;
  /**
   * Workspace root for the .generated/ tree. Defaults to the current
   * working directory + "extensions/.generated/". Tests inject a temp
   * dir.
   */
  readonly generatedRoot?: string;
};

const DEFAULT_GENERATED_ROOT_NAME = path.join("extensions", ".generated");
const SELF_CODER_MAX_TOKENS = 4096;

export type SelfCoderTaskInput = {
  readonly requestId: string;
};

export function createSelfCoderWorker(opts: SelfCoderOptions): ProjectWorker {
  return async ({ task, project }): Promise<ProjectWorkerOutput> => {
    const input = task.input as { requestId?: unknown };
    const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
    if (!requestId) {
      return {
        ok: false,
        error: "self-coder requires { requestId } in task.input",
      };
    }

    const requests = await readCapabilityRequests();
    const request = requests.find((r) => r.id === requestId);
    if (!request) {
      return {
        ok: false,
        error: `capability request not found: ${requestId}. Records live at ${resolveCapabilityRequestsPath()}.`,
      };
    }
    if (request.status === "fulfilled") {
      return {
        ok: false,
        error: `capability request ${requestId} is already fulfilled. Inspect the prior output before regenerating.`,
      };
    }

    const generatedRoot =
      opts.generatedRoot ?? path.join(process.cwd(), DEFAULT_GENERATED_ROOT_NAME);
    const targetDir = path.join(generatedRoot, sanitizeId(request.integration));

    let result: SelfCoderGeneration;
    let usage: LlmUsage | undefined;
    try {
      const completion = await opts.llm.complete({
        system: SELF_CODER_SYSTEM_PROMPT,
        user: renderSelfCoderUserPrompt(request),
        purpose: "self-coder",
        maxTokens: SELF_CODER_MAX_TOKENS,
      });
      usage = completion.usage;
      result = parseSelfCoderResponse(completion.text);
    } catch (err) {
      return {
        ok: false,
        error: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (result.files.length === 0) {
      return {
        ok: false,
        error: "LLM returned no files; nothing was generated.",
      };
    }

    try {
      await fs.mkdir(targetDir, { recursive: true });
      for (const file of result.files) {
        const safePath = resolveSafeChildPath(targetDir, file.path);
        if (!safePath) {
          return {
            ok: false,
            error: `LLM tried to write outside the sandbox (${file.path}); aborting.`,
          };
        }
        await fs.mkdir(path.dirname(safePath), { recursive: true });
        await fs.writeFile(safePath, file.contents, { encoding: "utf8", mode: 0o644 });
      }
      await markFulfilled(requestId, targetDir);
    } catch (err) {
      return {
        ok: false,
        error: `file write failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (opts.auditLogPath) {
      emitProjectsAuditEvent(
        {
          kind: "projects.capability.code_generated",
          payload: {
            projectId: project.id,
            taskId: task.id,
            requestId: request.id,
            integration: request.integration,
            targetDir,
            fileCount: result.files.length,
            files: result.files.map((f) => f.path),
            ...(typeof usage !== "undefined" ? { costUsd: estimateCostUsd(usage) } : {}),
          },
        },
        { auditLogPath: opts.auditLogPath },
      );
    }

    return {
      ok: true,
      // Worker stops at "review" — operator must look at the generated code
      // before anything happens with it.
      toReview: true,
      result: {
        capabilityGenerated: {
          requestId: request.id,
          integration: request.integration,
          targetDir,
          files: result.files.map((f) => f.path),
        },
      },
      ...(typeof usage !== "undefined" ? { costUsd: estimateCostUsd(usage) } : {}),
    };
  };
}

// ---- LLM contract ----

type SelfCoderFile = {
  readonly path: string;
  readonly contents: string;
};

type SelfCoderGeneration = {
  readonly files: ReadonlyArray<SelfCoderFile>;
};

const SELF_CODER_SYSTEM_PROMPT = `You are the self-coder for Alien — an autonomous AI workforce. Your job is to write a brand-new capability stub when the planner has identified a gap.

You output strict JSON in this exact shape, no prose, no fences:

{
  "files": [
    { "path": "index.mjs",  "contents": "<ESM JavaScript module with JSDoc>" },
    { "path": "types.d.ts", "contents": "<TypeScript .d.ts type declarations, for human review>" },
    { "path": "README.md",  "contents": "<markdown notes>" }
  ]
}

Hard rules:
1. The three files above are required. Do not add others.
2. index.mjs must export a function \`export async function run(input, deps)\`
   that accepts the input the planner will pass and returns the output
   the planner expects. Use JSDoc types referring to types.d.ts so the
   reviewer gets type hints without a compile step. The file must be
   valid ECMAScript so 'await import(file://.../index.mjs)' loads it.
3. Implementations are STUBS for v0.1. Return mock/placeholder data and
   leave a clear "TODO" comment in the body — DO NOT actually call any
   external API, write to disk, or invoke deps you weren't given. The
   operator will review and harden the stub before activation.
4. types.d.ts exports two named types: \`Input\` and \`Output\`. Mirror the
   sketch the operator provided. (Editor-only; not executed.)
5. README.md explains in plain English: what the capability does, what
   the planner can pass it, what gets returned, what the operator still
   needs to wire up (auth, API client init, error handling).
6. All file paths are relative to the sandbox dir. Never use \`..\` or
   absolute paths — your output is rejected if you try to escape.
7. No imports outside the sandbox (no \`../../src/...\`). Use only the
   \`deps\` parameter and the standard JS globals available to ESM.`;

function renderSelfCoderUserPrompt(req: {
  integration: string;
  why: string;
  sketch?: string;
}): string {
  return [
    `Capability request:`,
    `  integration: ${req.integration}`,
    `  why: ${req.why}`,
    req.sketch ? `  sketch: ${req.sketch}` : `  sketch: (none — design a minimal sensible surface)`,
    ``,
    `Generate the three files. Return strict JSON.`,
  ].join("\n");
}

function parseSelfCoderResponse(text: string): SelfCoderGeneration {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fence?.[1] ?? trimmed;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { files?: unknown }).files)
    ) {
      const raw = (parsed as { files: unknown[] }).files;
      const files: SelfCoderFile[] = [];
      for (const entry of raw) {
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as { path?: unknown }).path === "string" &&
          typeof (entry as { contents?: unknown }).contents === "string"
        ) {
          files.push({
            path: (entry as { path: string }).path,
            contents: (entry as { contents: string }).contents,
          });
        }
      }
      return { files };
    }
  } catch {
    // fall through
  }
  return { files: [] };
}

// ---- sandbox helpers ----

function sanitizeId(id: string): string {
  // Kebab-case, alphanum + hyphens only. No spaces, no traversal.
  const cleaned = id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "unnamed";
}

/**
 * Resolve `child` relative to `root` and ensure the result stays inside
 * `root`. Returns the absolute path on success, or undefined on attempted
 * traversal.
 */
function resolveSafeChildPath(root: string, child: string): string | undefined {
  if (path.isAbsolute(child)) return undefined;
  const resolved = path.resolve(root, child);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return resolved;
}

async function markFulfilled(requestId: string, targetDir: string): Promise<void> {
  // Re-read, mutate, write atomically-ish. The request store is small
  // enough that read-modify-write is fine here; Phase E adds locking.
  const allRequests = await readCapabilityRequests();
  const next = allRequests.map((r) =>
    r.id === requestId
      ? { ...r, status: "fulfilled" as const, resolution: `Generated stub at ${targetDir}` }
      : r,
  );
  await fs.writeFile(
    resolveCapabilityRequestsPath(),
    `${JSON.stringify({ version: 1, requests: next }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.chmod(resolveCapabilityRequestsPath(), 0o600).catch(() => {});
}

/** Reuse for tests + the HTTP endpoint that triggers a build. */
export function defaultGeneratedRoot(): string {
  const stateRoot = resolveStateDir();
  // Prefer a project-local extensions/.generated when one already exists;
  // otherwise put it under the state dir so dev-mode installs don't litter
  // the workspace.
  return path.join(stateRoot, "extensions-generated");
}
