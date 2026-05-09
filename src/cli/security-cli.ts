import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { getRuntimeConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { defaultRuntime } from "../runtime.js";
import { verifyAuditLog } from "../security/audit-log.js";
import { runSecurityAudit } from "../security/audit.js";
import { fixSecurityFootguns } from "../security/fix.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { formatDocsLink } from "../terminal/links.js";
import { isRich, theme } from "../terminal/theme.js";
import { shortenHomeInString, shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";
import { resolveCommandSecretRefsViaGateway } from "./command-secret-gateway.js";
import { getSecurityAuditCommandSecretTargetIds } from "./command-secret-targets.js";
import { formatHelpExamples } from "./help-format.js";

type SecurityAuditOptions = {
  json?: boolean;
  deep?: boolean;
  fix?: boolean;
  token?: string;
  password?: string;
};

function formatSummary(summary: { critical: number; warn: number; info: number }): string {
  const rich = isRich();
  const c = summary.critical;
  const w = summary.warn;
  const i = summary.info;
  const parts: string[] = [];
  parts.push(rich ? theme.error(`${c} critical`) : `${c} critical`);
  parts.push(rich ? theme.warn(`${w} warn`) : `${w} warn`);
  parts.push(rich ? theme.muted(`${i} info`) : `${i} info`);
  return parts.join(" · ");
}

export function registerSecurityCli(program: Command) {
  const security = program
    .command("security")
    .description("Audit local config and state for common security foot-guns")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["alien security audit", "Run a local security audit."],
          [
            "alien security audit --deep",
            "Include best-effort live Gateway probes and plugin-owned security audit collectors.",
          ],
          ["alien security audit --deep --token <token>", "Use explicit token for deep probe."],
          [
            "alien security audit --deep --password <password>",
            "Use explicit password for deep probe.",
          ],
          ["alien security audit --fix", "Apply safe remediations and file-permission fixes."],
          ["alien security audit --json", "Output machine-readable JSON."],
          [
            "alien security audit-log",
            "Verify the tamper-evident audit log chain and show recent entries.",
          ],
          [
            "alien security audit-log --tail 50 --json",
            "Print the last 50 entries plus chain status as JSON.",
          ],
        ])}\n\n${theme.muted("Docs:")} ${formatDocsLink("/cli/security", "docs.alien.ai/cli/security")}\n`,
    );

  security
    .command("audit")
    .description("Audit config + local state for common security foot-guns")
    .option("--deep", "Attempt live Gateway probes and plugin-owned collector checks", false)
    .option("--token <token>", "Use explicit gateway token for deep probe auth")
    .option("--password <password>", "Use explicit gateway password for deep probe auth")
    .option("--fix", "Apply safe fixes (tighten defaults + chmod state/config)", false)
    .option("--json", "Print JSON", false)
    .action(async (opts: SecurityAuditOptions) => {
      const token = normalizeOptionalString(opts.token);
      const password = normalizeOptionalString(opts.password);
      const fixResult = opts.fix ? await fixSecurityFootguns().catch((_err) => null) : null;

      const sourceConfig = getRuntimeConfig();
      const { resolvedConfig: cfg, diagnostics: secretDiagnostics } =
        await resolveCommandSecretRefsViaGateway({
          config: sourceConfig,
          commandName: "security audit",
          targetIds: getSecurityAuditCommandSecretTargetIds(),
          mode: "read_only_status",
        });
      const report = await runSecurityAudit({
        config: cfg,
        sourceConfig,
        deep: Boolean(opts.deep),
        includeFilesystem: true,
        includeChannelSecurity: true,
        deepProbeAuth:
          token || password
            ? { ...(token ? { token } : {}), ...(password ? { password } : {}) }
            : undefined,
      });

      if (opts.json) {
        defaultRuntime.writeJson(
          fixResult
            ? { fix: fixResult, report, secretDiagnostics }
            : { ...report, secretDiagnostics },
        );
        return;
      }

      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);

      const lines: string[] = [];
      lines.push(heading("Alien security audit"));
      lines.push(muted(`Summary: ${formatSummary(report.summary)}`));
      lines.push(muted(`Run deeper: ${formatCliCommand("alien security audit --deep")}`));
      for (const diagnostic of secretDiagnostics) {
        lines.push(muted(`[secrets] ${diagnostic}`));
      }

      if (opts.fix) {
        lines.push(muted(`Fix: ${formatCliCommand("alien security audit --fix")}`));
        if (!fixResult) {
          lines.push(muted("Fixes: failed to apply (unexpected error)"));
        } else if (
          fixResult.errors.length === 0 &&
          fixResult.changes.length === 0 &&
          fixResult.actions.every((a) => !a.ok)
        ) {
          lines.push(muted("Fixes: no changes applied"));
        } else {
          lines.push("");
          lines.push(heading("FIX"));
          for (const change of fixResult.changes) {
            lines.push(muted(`  ${shortenHomeInString(change)}`));
          }
          for (const action of fixResult.actions) {
            if (action.kind === "chmod") {
              const mode = action.mode.toString(8).padStart(3, "0");
              if (action.ok) {
                lines.push(muted(`  chmod ${mode} ${shortenHomePath(action.path)}`));
              } else if (action.skipped) {
                lines.push(
                  muted(`  skip chmod ${mode} ${shortenHomePath(action.path)} (${action.skipped})`),
                );
              } else if (action.error) {
                lines.push(
                  muted(`  chmod ${mode} ${shortenHomePath(action.path)} failed: ${action.error}`),
                );
              }
              continue;
            }
            const command = shortenHomeInString(action.command);
            if (action.ok) {
              lines.push(muted(`  ${command}`));
            } else if (action.skipped) {
              lines.push(muted(`  skip ${command} (${action.skipped})`));
            } else if (action.error) {
              lines.push(muted(`  ${command} failed: ${action.error}`));
            }
          }
          if (fixResult.errors.length > 0) {
            for (const err of fixResult.errors) {
              lines.push(muted(`  error: ${shortenHomeInString(err)}`));
            }
          }
        }
      }

      const bySeverity = (sev: "critical" | "warn" | "info") =>
        report.findings.filter((f) => f.severity === sev);

      const render = (sev: "critical" | "warn" | "info") => {
        const list = bySeverity(sev);
        if (list.length === 0) {
          return;
        }
        const label =
          sev === "critical"
            ? rich
              ? theme.error("CRITICAL")
              : "CRITICAL"
            : sev === "warn"
              ? rich
                ? theme.warn("WARN")
                : "WARN"
              : rich
                ? theme.muted("INFO")
                : "INFO";
        lines.push("");
        lines.push(heading(label));
        for (const f of list) {
          lines.push(`${theme.muted(f.checkId)} ${f.title}`);
          lines.push(`  ${f.detail}`);
          if (f.remediation?.trim()) {
            lines.push(`  ${muted(`Fix: ${f.remediation.trim()}`)}`);
          }
        }
      };

      render("critical");
      render("warn");
      render("info");

      defaultRuntime.log(lines.join("\n"));
    });

  // Audit M4: operator-facing inspector for the tamper-evident audit log
  // (the JSONL file written by cron-guard / self-edit-guard / sessions_send /
  // exec / H6 refusal). `--json` prints the parsed report; otherwise a
  // formatted summary is shown.
  security
    .command("audit-log")
    .description("Verify the tamper-evident audit log chain and summarize recent entries")
    .option("--tail <n>", "Show the last N entries (default 20)", "20")
    .option("--json", "Print machine-readable JSON", false)
    .option("--path <path>", "Path to the audit log (defaults to <state-dir>/audit.log)")
    .action(async (opts: { tail?: string; json?: boolean; path?: string }) => {
      const logPath =
        normalizeOptionalString(opts.path) ?? path.join(resolveStateDir(process.env), "audit.log");
      const tail = clampTailLimit(opts.tail);
      const verification = verifyAuditLog(logPath);
      const entries = readAuditLogEntries(logPath, tail);
      const kindCounts = countByField(entries, "kind");
      const originCounts = countByField(entries, "origin");

      if (opts.json) {
        defaultRuntime.writeJson({
          logPath,
          verification,
          entryCount: entries.length,
          tail,
          kindCounts,
          originCounts,
          recent: entries.slice(-tail),
        });
        return;
      }

      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);
      const error = (text: string) => (rich ? theme.error(text) : text);
      const ok = (text: string) => (rich ? theme.success(text) : text);

      const lines: string[] = [];
      lines.push(heading("Alien audit log"));
      lines.push(muted(`Path: ${shortenHomePath(logPath)}`));
      if (verification.ok) {
        lines.push(`${ok("✓ chain intact")} (${verification.count} entries)`);
      } else {
        lines.push(
          error(`✗ chain broken at index ${verification.breakIndex}: ${verification.reason}`),
        );
      }
      if (entries.length === 0) {
        lines.push(muted("(no entries)"));
        defaultRuntime.log(lines.join("\n"));
        return;
      }

      const formatCounts = (counts: Record<string, number>) =>
        Object.entries(counts)
          .toSorted((a, b) => b[1] - a[1])
          .map(([k, n]) => `${k}=${n}`)
          .join("  ");

      lines.push("");
      lines.push(heading("By kind"));
      lines.push(`  ${formatCounts(kindCounts)}`);
      lines.push("");
      lines.push(heading("By origin"));
      lines.push(`  ${formatCounts(originCounts)}`);
      lines.push("");
      lines.push(heading(`Last ${Math.min(tail, entries.length)} entries`));
      for (const entry of entries.slice(-tail)) {
        lines.push(`  ${formatAuditEntryLine(entry)}`);
      }

      defaultRuntime.log(lines.join("\n"));
    });

  // Orchestrator MVP: run a daily-research workflow end-to-end. Builds the
  // workflow plan, instantiates the workers with a real Anthropic LLM client,
  // and runs the runner. Audit-log + run-state are both persisted under the
  // resolved state dir.
  security
    .command("orchestrator-run")
    .description("Run the daily-research orchestrator workflow end-to-end")
    .option("--topics <topics>", "Comma-separated list of topics (e.g. 'WebAssembly,Rust,Bun')")
    .option(
      "--output <path>",
      "Output markdown path (default <state-dir>/orchestrator/runs/<runId>.md)",
    )
    .option("--title <title>", "Newsletter title", "Daily Brief")
    .option("--word-target <n>", "Words per summary (default 120)", "120")
    .option("--run-id <id>", "Stable run id (default auto-generated)")
    .option("--model <model>", "Anthropic model id", "claude-sonnet-4-6")
    .option("--json", "Print machine-readable JSON result", false)
    .action(
      async (opts: {
        topics?: string;
        output?: string;
        title?: string;
        wordTarget?: string;
        runId?: string;
        model?: string;
        json?: boolean;
      }) => {
        const topics = (opts.topics ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        if (topics.length === 0) {
          defaultRuntime.error("--topics is required (comma-separated list)");
          defaultRuntime.exit(1);
          return;
        }
        const wordTarget = Number.parseInt(opts.wordTarget ?? "120", 10);
        const runId = (opts.runId ?? `run-${Date.now()}`).replace(/[^A-Za-z0-9_.-]/g, "-");
        const stateDir = resolveStateDir(process.env);
        const orchestratorDir = path.join(stateDir, "orchestrator");
        const outputPath =
          normalizeOptionalString(opts.output) ?? path.join(orchestratorDir, "runs", `${runId}.md`);
        const auditLogPath = path.join(stateDir, "audit.log");

        const { planDailyResearchWorkflow } =
          await import("../orchestrator/workflows/daily-research.js");
        const { createRunFromWorkflow } = await import("../orchestrator/run-state.js");
        const { runOrchestratorRun } = await import("../orchestrator/runner.js");
        const { createDailyResearchWorkers } = await import("../orchestrator/workers.js");
        const { createAnthropicLlmClient } = await import("../orchestrator/llm-client.js");

        let llm: Awaited<ReturnType<typeof createAnthropicLlmClient>>;
        try {
          llm = await createAnthropicLlmClient({
            ...(opts.model ? { model: opts.model } : {}),
          });
        } catch (err) {
          defaultRuntime.error(String(err));
          defaultRuntime.exit(1);
          return;
        }
        const workers = createDailyResearchWorkers({ llm });

        const workflow = planDailyResearchWorkflow({
          runId,
          topics,
          outputPath,
          title: opts.title ?? "Daily Brief",
          wordTarget,
        });
        const run = createRunFromWorkflow({ runId, workflow });

        defaultRuntime.log(`Running orchestrator workflow ${workflow.id} (run=${runId})`);
        defaultRuntime.log(`  topics: ${topics.join(", ")}`);
        defaultRuntime.log(`  output: ${shortenHomePath(outputPath)}`);

        const result = await runOrchestratorRun(run, workers, {
          orchestratorDir,
          auditLogPath: process.env.ALIEN_DISABLE_AUDIT_LOG === "1" ? undefined : auditLogPath,
        });

        if (opts.json) {
          defaultRuntime.writeJson({
            runId,
            workflowId: workflow.id,
            status: result.run.status,
            tasksAttempted: result.tasksAttempted,
            outputPath,
            tasks: result.run.tasks.map((t) => ({
              id: t.id,
              role: t.role,
              status: t.status,
              ...(t.error ? { error: t.error } : {}),
            })),
          });
          return;
        }

        const rich = isRich();
        const ok = (s: string) => (rich ? theme.success(s) : s);
        const error = (s: string) => (rich ? theme.error(s) : s);
        const muted = (s: string) => (rich ? theme.muted(s) : s);

        for (const task of result.run.tasks) {
          const status = task.status;
          const label =
            status === "succeeded" ? ok("✓") : status === "failed" ? error("✗") : muted("·");
          defaultRuntime.log(
            `  ${label} ${task.id.padEnd(14)}  ${task.summary}${task.error ? ` — ${task.error}` : ""}`,
          );
        }
        const final =
          result.run.status === "succeeded"
            ? ok(`Run succeeded → ${shortenHomePath(outputPath)}`)
            : error(
                `Run ${result.run.status} (see audit.log + ${shortenHomePath(orchestratorDir)})`,
              );
        defaultRuntime.log(final);
        if (result.run.status !== "succeeded") {
          defaultRuntime.exit(1);
        }
      },
    );
}

function clampTailLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "20", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(parsed, 1000);
}

type AuditEntryRecord = {
  ts?: string;
  kind?: string;
  payload?: Record<string, unknown>;
};

function readAuditLogEntries(logPath: string, _tail: number): AuditEntryRecord[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const raw = fs.readFileSync(logPath, "utf8");
  const lines = raw.split("\n").filter((line) => line.length > 0);
  const out: AuditEntryRecord[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as AuditEntryRecord;
      out.push(parsed);
    } catch {
      // skip unparseable lines — verifyAuditLog will already have flagged them
    }
  }
  return out;
}

function countByField(
  entries: AuditEntryRecord[],
  field: "kind" | "origin",
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    let key: string;
    if (field === "kind") {
      key = entry.kind ?? "(unknown)";
    } else {
      const payload = entry.payload;
      const origin =
        payload && typeof payload === "object" && typeof payload.origin === "string"
          ? payload.origin
          : "(unknown)";
      key = origin;
    }
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function formatAuditEntryLine(entry: AuditEntryRecord): string {
  const ts = entry.ts ?? "?";
  const kind = entry.kind ?? "?";
  const payload = entry.payload ?? {};
  const origin =
    typeof (payload as { origin?: unknown }).origin === "string"
      ? (payload as { origin: string }).origin
      : "?";
  const summary: string[] = [];
  for (const key of ["target", "command", "sessionKey", "label", "action", "messageBytes"]) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === "string" && value) {
      summary.push(`${key}=${truncateForLog(value, 60)}`);
    } else if (typeof value === "number") {
      summary.push(`${key}=${value}`);
    }
  }
  return `${ts}  ${kind.padEnd(24)}  origin=${origin.padEnd(20)}  ${summary.join("  ")}`;
}

function truncateForLog(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
