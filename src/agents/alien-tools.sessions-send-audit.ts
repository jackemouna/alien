import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { logWarn } from "../logger.js";
import { appendAuditLog } from "../security/audit-log.js";
import { currentOrigin } from "../security/origin-context.js";
import { getToolParamsRecord } from "./pi-tools.params.js";
import type { AnyAgentTool } from "./tools/common.js";

/**
 * Audit M4: wrap the `sessions_send` tool so every invocation is recorded
 * in the hash-chained audit log with the target identifier (sessionKey or
 * label), the message size in bytes (NOT the message content — that could
 * leak secrets), the origin from origin-context (M3), and the tool's
 * declared status when known.
 *
 * `sessions_send` is high-blast for two reasons:
 *
 *   1. It can fan out to subagent sessions, which then run their own tool
 *      calls under inherited-but-not-identical privileges.
 *   2. It crosses session boundaries the model does not always reason
 *      cleanly about — a prompt-injected channel DM can use sessions_send
 *      to nudge the operator's main session into running something the
 *      operator never asked for.
 *
 * Logging it gives forensic visibility on who sent what to whom even when
 * the send was authorized at policy time.
 */
export function applySessionsSendAuditLog(
  base: AnyAgentTool,
  options: {
    /**
     * Path to the tamper-evident audit log. Unset = no audit-log write
     * (the tool still runs normally).
     */
    readonly auditLogPath?: string;
  },
): AnyAgentTool {
  return {
    ...base,
    execute: async (
      toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate?: AgentToolUpdateCallback<unknown>,
    ) => {
      const result = await base.execute(toolCallId, params, signal, onUpdate);
      if (options.auditLogPath) {
        try {
          const record = getToolParamsRecord(params);
          const sessionKey = typeof record?.sessionKey === "string" ? record.sessionKey : undefined;
          const label = typeof record?.label === "string" ? record.label : undefined;
          const agentId = typeof record?.agentId === "string" ? record.agentId : undefined;
          const messageBytes =
            typeof record?.message === "string" ? Buffer.byteLength(record.message, "utf8") : 0;
          const origin = currentOrigin();
          const status = readToolResultStatus(result);
          appendAuditLog(
            {
              kind: "sessions_send",
              payload: {
                toolCallId,
                ...(sessionKey ? { sessionKey } : {}),
                ...(label ? { label } : {}),
                ...(agentId ? { agentId } : {}),
                messageBytes,
                resultIsError: Boolean(result.isError),
                ...(status ? { resultStatus: status } : {}),
                origin: origin.source,
                originUntrusted: origin.untrusted,
                ...(origin.details ? { originDetails: origin.details } : {}),
              },
            },
            { logPath: options.auditLogPath },
          );
        } catch (err) {
          // Audit log failure must not break the tool call.
          logWarn("audit-log append failed (sessions_send)", { error: String(err) });
        }
      }
      return result;
    },
  };
}

/**
 * sessions_send returns a JSON tool-result with a `status` field; lift it
 * out so the audit-log entry can record approved/blocked/error/etc.
 */
function readToolResultStatus(result: AgentToolResult<unknown>): string | undefined {
  const content = result.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const part of content) {
    if (part && typeof part === "object" && "type" in part && part.type === "text") {
      const text = (part as { text?: unknown }).text;
      if (typeof text !== "string") {
        continue;
      }
      try {
        const parsed = JSON.parse(text) as { status?: unknown };
        if (typeof parsed.status === "string") {
          return parsed.status;
        }
      } catch {
        // Not all sessions_send tool-result text is JSON. That's fine.
      }
    }
  }
  return undefined;
}
