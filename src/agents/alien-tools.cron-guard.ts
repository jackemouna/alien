import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { logWarn } from "../logger.js";
import { appendAuditLog } from "../security/audit-log.js";
import { getToolParamsRecord } from "./pi-tools.params.js";
import type { AnyAgentTool } from "./tools/common.js";

/**
 * Cron actions that mutate the schedule or trigger a job. Read-only actions
 * (status, list, runs) are not gated.
 */
const CRON_WRITE_ACTIONS: ReadonlySet<string> = new Set(["add", "update", "remove", "run", "wake"]);

/**
 * Audit H3: every write-class cron call is logged at warn level so the
 * operator can grep for them in the gateway log. When
 * `ALIEN_DENY_CRON_WRITES=1` is set, the call is refused with a structured
 * tool-result error (no destructive action taken, but the model sees the
 * refusal and can adjust its plan).
 *
 * This is intentionally a smaller fix than the audit's "approval gate"
 * proposal — generalizing the existing exec-approvals pipeline to all
 * tool calls is a much larger refactor that should land separately.
 * What's here is the minimum viable visibility/lockdown control for
 * operators who want it.
 */
export function applyCronWriteGuard(
  base: AnyAgentTool,
  options: {
    /** Override hook for the env source (defaults to process.env). */
    envSource?: () => NodeJS.ProcessEnv;
    /** Override hook for the warn-logger (defaults to logger.logWarn). */
    log?: (message: string, meta?: Record<string, unknown>) => void;
    /**
     * Audit M4: when set, every write-class cron action is recorded in a
     * tamper-evident JSONL log at this path in addition to the warn log.
     * Unset = no audit-log write.
     */
    auditLogPath?: string;
  } = {},
): AnyAgentTool {
  const envSource = options.envSource ?? (() => process.env);
  const log = options.log ?? ((message, meta) => logWarn(message, meta));
  return {
    ...base,
    execute: async (
      toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate?: AgentToolUpdateCallback<unknown>,
    ) => {
      const record = getToolParamsRecord(params);
      const action = typeof record?.action === "string" ? record.action : "";
      if (!CRON_WRITE_ACTIONS.has(action)) {
        return base.execute(toolCallId, params, signal, onUpdate);
      }

      const denied = envSource().ALIEN_DENY_CRON_WRITES === "1";
      log("cron write action invoked", { action, toolCallId, denied });

      if (options.auditLogPath) {
        try {
          appendAuditLog(
            {
              kind: denied ? "cron.refused" : `cron.${action}`,
              payload: { action, toolCallId, denied },
            },
            { logPath: options.auditLogPath },
          );
        } catch (err) {
          // Audit log failure must not break the tool call. Surface via warn
          // log so operators notice the integrity gap.
          log("audit-log append failed", { error: String(err) });
        }
      }

      if (denied) {
        return buildCronRefusalResult(action);
      }
      return base.execute(toolCallId, params, signal, onUpdate);
    },
  };
}

function buildCronRefusalResult(action: string): AgentToolResult<unknown> {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Cron action "${action}" was refused by ALIEN_DENY_CRON_WRITES=1 (audit H3). Unset the env var or set it to 0 to allow the cron tool to make scheduling changes.`,
      },
    ],
  } as AgentToolResult<unknown>;
}
