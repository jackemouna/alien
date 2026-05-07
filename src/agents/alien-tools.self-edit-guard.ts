import path from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { expandHomePrefix, resolveOsHomeDir } from "../infra/home-dir.js";
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
          return buildRefusalResult(decision.reason);
        }
      }
      return base.execute(toolCallId, params, signal, onUpdate);
    },
  };
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
