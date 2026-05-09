import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { logWarn } from "../logger.js";
import { redactSensitiveText } from "../logging/redact.js";
import { appendAuditLog } from "../security/audit-log.js";
import { currentOrigin } from "../security/origin-context.js";
import { getToolParamsRecord } from "./pi-tools.params.js";
import type { AnyAgentTool } from "./tools/common.js";

/**
 * Audit M4: wrap the `exec` tool so every invocation is recorded in the
 * tamper-evident audit log with a redacted command summary, target host,
 * exit code, duration, and origin (M3).
 *
 * `exec` is the highest-blast tool in the system: a single command line
 * can read every secret on disk, exfiltrate over the network, or pivot to
 * any other process. Logging it with origin tags closes the forensic loop
 * — combined with the existing exec-approvals pipeline, an operator can
 * answer "what shell commands ran in the last hour, and which inbound
 * channel triggered each".
 *
 * Volume considerations:
 *   - The wrapper is opt-out via `ALIEN_DISABLE_AUDIT_LOG=1` (the same
 *     flag that gates cron / self-edit / sessions_send instrumentation).
 *   - Operators who explicitly want to skip ONLY exec audit logging can
 *     set `ALIEN_AUDIT_LOG_EXEC=0`. The wrapper still runs the tool; only
 *     the audit-log write is skipped.
 *   - `command` is truncated to 200 chars and run through
 *     `redactSensitiveText` so embedded tokens are masked before they hit
 *     the log file. Stdout/stderr content is NOT logged — that surface
 *     can contain secrets and is captured separately by the gateway WS log.
 */
const EXEC_COMMAND_LOG_LIMIT = 200;

export function applyExecAuditLog(
  base: AnyAgentTool,
  options: {
    /** Path to the tamper-evident audit log. Unset = no write. */
    readonly auditLogPath?: string;
    /** Override env source for tests (defaults to process.env). */
    readonly envSource?: () => NodeJS.ProcessEnv;
  },
): AnyAgentTool {
  const envSource = options.envSource ?? (() => process.env);
  return {
    ...base,
    execute: async (
      toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate?: AgentToolUpdateCallback<unknown>,
    ) => {
      const startedAt = Date.now();
      const result = await base.execute(toolCallId, params, signal, onUpdate);
      const env = envSource();
      if (options.auditLogPath && env.ALIEN_AUDIT_LOG_EXEC !== "0") {
        try {
          const record = getToolParamsRecord(params);
          const rawCommand = typeof record?.command === "string" ? record.command : "";
          const summary = redactExecCommand(rawCommand);
          const host = typeof record?.host === "string" ? record.host : undefined;
          const elevated = record?.elevated === true;
          const background = record?.background === true;
          const details = (result as AgentToolResult<{ exitCode?: unknown; durationMs?: unknown }>)
            .details;
          const exitCode =
            details && typeof details === "object" && "exitCode" in details
              ? toFiniteIntOrNull(details.exitCode)
              : null;
          const durationMs =
            details && typeof details === "object" && "durationMs" in details
              ? toFiniteIntOrNull(details.durationMs)
              : null;
          const observedDurationMs = Date.now() - startedAt;
          const origin = currentOrigin();
          appendAuditLog(
            {
              kind: "exec.invoked",
              payload: {
                toolCallId,
                command: summary,
                commandTruncated: rawCommand.length > EXEC_COMMAND_LOG_LIMIT,
                ...(host ? { host } : {}),
                elevated,
                background,
                exitCode,
                durationMs: durationMs ?? observedDurationMs,
                resultIsError: Boolean(result.isError),
                origin: origin.source,
                originUntrusted: origin.untrusted,
                ...(origin.details ? { originDetails: origin.details } : {}),
              },
            },
            { logPath: options.auditLogPath },
          );
        } catch (err) {
          // Audit log failure must not break the tool call.
          logWarn("audit-log append failed (exec)", { error: String(err) });
        }
      }
      return result;
    },
  };
}

function redactExecCommand(command: string): string {
  if (!command) {
    return "";
  }
  const truncated =
    command.length > EXEC_COMMAND_LOG_LIMIT
      ? `${command.slice(0, EXEC_COMMAND_LOG_LIMIT)}…`
      : command;
  // redactSensitiveText reads logging config at call time. Pass the
  // mode explicitly so this works even when no config has been loaded
  // (e.g. before gateway startup or in fresh tests).
  return redactSensitiveText(truncated, { mode: "tools" });
}

function toFiniteIntOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}
