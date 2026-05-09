import path from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { expandHomePrefix, resolveOsHomeDir } from "../infra/home-dir.js";
import { logWarn } from "../logger.js";
import { appendAuditLog } from "../security/audit-log.js";
import { currentOrigin } from "../security/origin-context.js";
import { checkSelfEditGuard } from "../security/self-edit-guard.js";
import { getToolParamsRecord } from "./pi-tools.params.js";
import type { AnyAgentTool } from "./tools/common.js";

/**
 * Wrap a host fs_write / edit tool with the self-edit guard from
 * [`src/security/self-edit-guard.ts`](../security/self-edit-guard.ts).
 *
 * Audit reference: [AUDIT.md](../../AUDIT.md) H2.
 */
export function applySelfEditGuard(
  base: AnyAgentTool,
  options: {
    /** Tool's working-directory root for resolving relative paths. */
    readonly root: string;
    /** Alien's install root — writes inside this tree are refused. */
    readonly installRoot: string | undefined;
    /** Optional override of the env source (defaults to process.env). */
    readonly envSource?: () => NodeJS.ProcessEnv;
    /**
     * Audit M4: when set, every self-edit attempt (allowed or refused) is
     * recorded in the tamper-evident audit log at this path. Audit writes
     * tag the entry with the origin from origin-context (M3) so a reviewer
     * can see whether the attempt came from operator/HTTP/channel input.
     */
    readonly auditLogPath?: string;
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
      const target = readResolvedTargetPath(params, options.root);
      if (target) {
        const decision = checkSelfEditGuard(target, {
          installRoot: options.installRoot,
          optOutEnvValue: envSource().ALIEN_ALLOW_SELF_EDIT,
        });
        if (!decision.allowed) {
          maybeAppendSelfEditAudit(options.auditLogPath, {
            kind: "self_edit.refused",
            target,
            toolCallId,
          });
          return buildRefusalResult(decision.reason);
        }
        // Allowed via env opt-out is itself a security-relevant event — log it.
        if (
          envSource().ALIEN_ALLOW_SELF_EDIT === "1" &&
          isInsideInstallTree(target, options.installRoot)
        ) {
          maybeAppendSelfEditAudit(options.auditLogPath, {
            kind: "self_edit.allowed",
            target,
            toolCallId,
          });
        }
      }
      return base.execute(toolCallId, params, signal, onUpdate);
    },
  };
}

function maybeAppendSelfEditAudit(
  logPath: string | undefined,
  event: { kind: "self_edit.refused" | "self_edit.allowed"; target: string; toolCallId: string },
): void {
  if (!logPath) {
    return;
  }
  try {
    const origin = currentOrigin();
    appendAuditLog(
      {
        kind: event.kind,
        payload: {
          target: event.target,
          toolCallId: event.toolCallId,
          origin: origin.source,
          originUntrusted: origin.untrusted,
          ...(origin.details ? { originDetails: origin.details } : {}),
        },
      },
      { logPath },
    );
  } catch (err) {
    logWarn("audit-log append failed (self-edit-guard)", { error: String(err) });
  }
}

function isInsideInstallTree(target: string, installRoot: string | undefined): boolean {
  if (!installRoot) {
    return false;
  }
  const root = path.resolve(installRoot);
  const resolved = path.resolve(target);
  if (resolved === root) {
    return true;
  }
  const rel = path.relative(root, resolved);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function readResolvedTargetPath(params: unknown, root: string): string | undefined {
  const record = getToolParamsRecord(params);
  const raw = record?.path;
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }
  const home = resolveOsHomeDir();
  const expanded = home ? expandHomePrefix(raw, { home }) : raw;
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(root, expanded);
}

function buildRefusalResult(reason: string): AgentToolResult<unknown> {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: reason,
      },
    ],
  } as AgentToolResult<unknown>;
}
