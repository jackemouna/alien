import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { AlienConfig } from "../config/types.alien.js";
import { logWarn } from "../logger.js";
import { createAnthropicLlmClient } from "../orchestrator/llm-client.js";
import { createDailyResearchWorkers } from "../orchestrator/workers.js";
import { bindChannelInboxToProjects } from "../projects/channel-inbox.js";
import type { ChannelReplySend } from "../projects/channel-reply.js";
import { adaptOrchestratorWorkerRegistry } from "../projects/orchestrator-worker-adapter.js";
import {
  startPickupLoop,
  type PickupLoopHandle,
  type ProjectWorkerRegistry,
} from "../projects/pickup-loop.js";

/**
 * Gateway-side glue for the Projects runtime. Boots:
 *
 *   1. An LLM client for the planner (deferred so the gateway boots even
 *      when ANTHROPIC_API_KEY is not configured — the projects HTTP routes
 *      and Kanban UI work without auto-pickup; the inbox listener silently
 *      ignores events).
 *   2. The auto-pickup loop (src/projects/pickup-loop.ts) with the
 *      orchestrator's daily-research worker chain adapted via
 *      adaptOrchestratorWorkerRegistry.
 *   3. The channel-inbox listener (src/projects/channel-inbox.ts) that
 *      routes inbound channel DMs to bound projects.
 *
 * Wiring this into the gateway boot path is left to a thin call site that
 * has access to the gateway config (see `src/cli/gateway-cli/run-loop.ts`
 * for where to plug in). For v0.1 this is a documented helper; the
 * follow-up wiring commit lands the actual call.
 */

export type ProjectsRuntimeOptions = {
  readonly cfg: AlienConfig;
  readonly projectsDir?: string;
  readonly auditLogPath?: string;
  readonly intervalMs?: number;
  readonly claimedBy?: string;
};

export type ProjectsRuntimeHandle = {
  readonly stop: () => void;
};

export async function startProjectsRuntime(
  opts: ProjectsRuntimeOptions,
): Promise<ProjectsRuntimeHandle> {
  const projectsDir = opts.projectsDir ?? path.join(resolveStateDir(process.env), "projects");
  const auditLogPath =
    opts.auditLogPath ??
    (process.env.ALIEN_DISABLE_AUDIT_LOG === "1"
      ? undefined
      : path.join(resolveStateDir(process.env), "audit.log"));

  let llm: Awaited<ReturnType<typeof createAnthropicLlmClient>> | null = null;
  try {
    llm = await createAnthropicLlmClient({});
  } catch (err) {
    // No ANTHROPIC_API_KEY (or keychain entry). The pickup loop will run
    // with workers that need the LLM, but it will only encounter tasks
    // when the planner has previously emitted them. We log once and
    // continue so the gateway is not gated on this dependency.
    logWarn(
      `projects-runtime: LLM unavailable; planner-driven flows will fail (${stringifyError(err)})`,
    );
  }

  const workers: ProjectWorkerRegistry = llm
    ? adaptOrchestratorWorkerRegistry(createDailyResearchWorkers({ llm }))
    : buildNoLlmWorkerRegistry();

  const sendChannelReply = buildChannelReplyAdapter(opts.cfg);

  const pickupHandle: PickupLoopHandle = startPickupLoop({
    projectsDir,
    workers,
    claimedBy: opts.claimedBy ?? "gateway",
    sendChannelReply,
    ...(opts.intervalMs ? { intervalMs: opts.intervalMs } : {}),
    ...(auditLogPath ? { auditLogPath } : {}),
  });

  const unbindInbox = llm
    ? bindChannelInboxToProjects({
        projectsDir,
        llm,
        ...(auditLogPath ? { auditLogPath } : {}),
        onRouteError: (err) =>
          logWarn(`projects-runtime: inbox route failed: ${stringifyError(err)}`),
      })
    : () => {};

  return {
    stop: () => {
      unbindInbox();
      pickupHandle.stop();
    },
  };
}

function buildChannelReplyAdapter(cfg: AlienConfig): ChannelReplySend {
  return async (params) => {
    const mod = await import("./../plugin-sdk/channel-message.js");
    const result = await mod.sendDurableMessageBatch({
      cfg,
      channel: params.channel as Exclude<
        Parameters<typeof mod.sendDurableMessageBatch>[0]["channel"],
        "none"
      >,
      to: params.to,
      ...(params.accountId ? { accountId: params.accountId } : {}),
      ...(params.threadId ? { threadId: params.threadId } : {}),
      payloads: [{ text: params.text }],
    });
    if (result.status === "failed") {
      throw result.error instanceof Error ? result.error : new Error(String(result.error));
    }
  };
}

function buildNoLlmWorkerRegistry(): ProjectWorkerRegistry {
  const refuse: ProjectWorkerRegistry[keyof ProjectWorkerRegistry] = async () => ({
    ok: false,
    error: "no LLM available — set ANTHROPIC_API_KEY (env or keychain) and restart the gateway",
  });
  return {
    researcher: refuse,
    writer: refuse,
    editor: refuse,
    publisher: refuse,
  };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
