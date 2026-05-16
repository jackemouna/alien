import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Pre-flight checks for a self-coded capability sandbox before
 * activation. The activator runs this before any file copy; if checks
 * fail and the operator didn't pass `force`, activation is aborted
 * with the structured result returned to the caller.
 *
 * Checks (cheap, no-side-effect-ish):
 *
 *   1. `index.mjs` exists at <sourceDir>/index.mjs
 *   2. The file dynamically imports cleanly (catches syntax errors,
 *      malformed imports, top-level throws). Note: importing DOES run
 *      top-level code — the LLM is instructed not to put any there.
 *      Operator review remains the trust gate.
 *   3. The module exports a `run` symbol that is a function.
 *   4. Source scan for obviously dangerous patterns (eval, Function
 *      constructor, dynamic `child_process` / `fs` requires).
 *      Findings are informational warnings, not hard failures —
 *      legitimate stubs may need fs/child_process eventually. The
 *      operator decides whether to proceed.
 *
 * Out of scope for this pass: actually invoking `run()` with mock
 * input. That's high-value but trickier (stub may hang) — covered by
 * a future preflight pass with a timeout.
 */

export type PreflightCheckName = "file-exists" | "module-imports" | "run-export" | "source-scan";

export type PreflightCheckResult = {
  readonly name: PreflightCheckName;
  readonly passed: boolean;
  readonly detail?: string;
  /** True for checks where a failure is just a warning, not a blocker. */
  readonly warningOnly?: boolean;
};

export type PreflightOutcome = {
  /** Overall verdict: true only when every hard check passed. */
  readonly ok: boolean;
  readonly checks: ReadonlyArray<PreflightCheckResult>;
  /** Human-readable summary of failures, empty when ok. */
  readonly errorSummary: string;
};

export async function runPreflight(sourceDir: string): Promise<PreflightOutcome> {
  const checks: PreflightCheckResult[] = [];
  const modulePath = path.join(sourceDir, "index.mjs");

  // 1. file-exists
  let fileExists = false;
  try {
    const stat = await fs.stat(modulePath);
    fileExists = stat.isFile();
    checks.push({
      name: "file-exists",
      passed: fileExists,
      ...(fileExists ? {} : { detail: `${modulePath} is not a regular file` }),
    });
  } catch (err) {
    checks.push({
      name: "file-exists",
      passed: false,
      detail: `index.mjs not found at ${modulePath} (${err instanceof Error ? err.message : String(err)})`,
    });
  }

  // 2. module-imports — only attempt if the file exists
  let mod: Record<string, unknown> | undefined;
  if (fileExists) {
    try {
      const url = `${pathToFileURL(modulePath).href}?preflight=${Date.now()}`;
      mod = (await import(url)) as Record<string, unknown>;
      checks.push({ name: "module-imports", passed: true });
    } catch (err) {
      checks.push({
        name: "module-imports",
        passed: false,
        detail: `import failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    checks.push({
      name: "module-imports",
      passed: false,
      detail: "skipped — file does not exist",
    });
  }

  // 3. run-export — only if module imported
  if (mod) {
    const runOk = typeof mod.run === "function";
    checks.push({
      name: "run-export",
      passed: runOk,
      ...(runOk
        ? {}
        : {
            detail: `expected \`export async function run(input, deps)\` — got ${describe(mod.run)}`,
          }),
    });
  } else {
    checks.push({
      name: "run-export",
      passed: false,
      detail: "skipped — module did not import",
    });
  }

  // 4. source-scan — informational warnings, doesn't gate ok
  if (fileExists) {
    const scan = await scanSource(modulePath);
    checks.push({
      name: "source-scan",
      passed: scan.findings.length === 0,
      warningOnly: true,
      ...(scan.findings.length === 0
        ? {}
        : { detail: `flagged patterns: ${scan.findings.join(", ")}` }),
    });
  } else {
    checks.push({
      name: "source-scan",
      passed: false,
      warningOnly: true,
      detail: "skipped — file does not exist",
    });
  }

  const hardFailures = checks.filter((c) => !c.passed && !c.warningOnly);
  const ok = hardFailures.length === 0;
  const errorSummary = hardFailures.map((c) => `${c.name}: ${c.detail ?? "failed"}`).join("; ");
  return { ok, checks, errorSummary };
}

async function scanSource(modulePath: string): Promise<{ findings: string[] }> {
  let body = "";
  try {
    body = await fs.readFile(modulePath, "utf8");
  } catch {
    return { findings: [] };
  }
  const patterns: Array<[RegExp, string]> = [
    [/\beval\s*\(/, "eval()"],
    [/\bnew\s+Function\s*\(/, "Function constructor"],
    [/import\s*\(\s*["']child_process["']\s*\)/, "dynamic child_process import"],
    [/from\s+["']child_process["']/, "child_process import"],
    [/from\s+["']node:fs["']/, "node:fs import"],
    [/from\s+["']fs["']/, "fs import"],
    [/from\s+["']node:child_process["']/, "node:child_process import"],
    [/\bprocess\.exit\b/, "process.exit"],
  ];
  const findings: string[] = [];
  for (const [pattern, label] of patterns) {
    if (pattern.test(body)) findings.push(label);
  }
  return { findings };
}

function describe(value: unknown): string {
  if (value === undefined) return "missing export";
  if (value === null) return "null";
  return typeof value;
}
