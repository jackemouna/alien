import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { AlienConfig } from "../config/types.alien.js";
import { resolveGmailOAuthClientConfig } from "../integrations/gmail/config.js";
import { createEmailHandlerWorker } from "../integrations/gmail/worker.js";
import { logWarn } from "../logger.js";
import type { LlmClient } from "../orchestrator/llm-client.js";
import { createAnthropicLlmClient } from "../orchestrator/llm-client.js";
import { createDailyResearchWorkers } from "../orchestrator/workers.js";
import { listLiveCapabilities } from "../projects/activated-capabilities-store.js";
import { emitProjectsAuditEvent } from "../projects/audit.js";
import { createCapabilityBrokerWorker } from "../projects/capability-broker.js";
import type { LiveCapability } from "../projects/capability-catalog.js";
import { createCapabilityRunnerWorker } from "../projects/capability-runner-worker.js";
import {
  createCapabilityRuntimeLoader,
  type CapabilityRuntimeLoader,
} from "../projects/capability-runtime-loader.js";
import { bindChannelInboxToProjects } from "../projects/channel-inbox.js";
import type { ChannelReplySend } from "../projects/channel-reply.js";
import { evaluate, defaultMaxIterations } from "../projects/evaluator.js";
import { adaptOrchestratorWorkerRegistry } from "../projects/orchestrator-worker-adapter.js";
import {
  startPickupLoop,
  type PickupLoopHandle,
  type ProjectWorker,
  type ProjectWorkerRegistry,
} from "../projects/pickup-loop.js";
import { persistPlan, plan } from "../projects/planner.js";
import { createSelfCoderWorker } from "../projects/self-coder.js";
import { listTasks, loadProject, saveProject } from "../projects/store.js";
import type { Project, TaskRecord } from "../projects/types.js";

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

  const brokerWorker = createCapabilityBrokerWorker({
    projectsDir,
    ...(auditLogPath ? { auditLogPath } : {}),
  });
  const selfCoderWorker = llm
    ? createSelfCoderWorker({ llm, ...(auditLogPath ? { auditLogPath } : {}) })
    : null;
  // Phase D2: singleton runtime loader for activated capabilities. The
  // gateway boot path also publishes the same handle so the
  // capabilities-http activate/deactivate endpoints can hot-load /
  // unload without restart.
  const runtimeLoader = createCapabilityRuntimeLoader();
  setActiveCapabilityRuntimeLoader(runtimeLoader);
  const runnerWorker = createCapabilityRunnerWorker(runtimeLoader);

  const workers: ProjectWorkerRegistry = llm
    ? {
        ...overrideEmailHandler(
          adaptOrchestratorWorkerRegistry(createDailyResearchWorkers({ llm })),
          buildEmailHandler(llm),
        ),
        "capability-broker": brokerWorker,
        ...(selfCoderWorker ? { "self-coder": selfCoderWorker } : {}),
        "capability-runner": runnerWorker,
      }
    : {
        ...buildNoLlmWorkerRegistry(),
        "capability-broker": brokerWorker,
        "capability-runner": runnerWorker,
      };

  // Boot-time restore: read activated-capabilities.json and re-load
  // each live entry into the in-process loader. Failures are logged
  // but don't block startup — operator can re-activate to retry.
  void (async () => {
    try {
      const live = await listLiveCapabilities();
      for (const record of live) {
        try {
          await runtimeLoader.loadCapability(record.id, record.activeDir);
        } catch (err) {
          logWarn(
            `capabilities: failed to restore "${record.id}" from ${record.activeDir}: ${stringifyError(err)}`,
          );
        }
      }
    } catch (err) {
      logWarn(`capabilities: failed to read activated list: ${stringifyError(err)}`);
    }
  })();

  const sendChannelReply = buildChannelReplyAdapter(opts.cfg);

  const onProjectIdle = llm
    ? buildGoalLoopHandler({ projectsDir, llm, ...(auditLogPath ? { auditLogPath } : {}) })
    : undefined;

  const pickupHandle: PickupLoopHandle = startPickupLoop({
    projectsDir,
    workers,
    claimedBy: opts.claimedBy ?? "gateway",
    sendChannelReply,
    ...(opts.intervalMs ? { intervalMs: opts.intervalMs } : {}),
    ...(auditLogPath ? { auditLogPath } : {}),
    ...(onProjectIdle ? { onProjectIdle } : {}),
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
  const refuse: ProjectWorker = async () => ({
    ok: false,
    error: "no LLM available — set ANTHROPIC_API_KEY (env or keychain) and restart the gateway",
  });
  return {
    researcher: refuse,
    writer: refuse,
    editor: refuse,
    publisher: refuse,
    "email-handler": refuse,
    "capability-broker": refuse,
    "self-coder": refuse,
    "capability-runner": refuse,
  };
}

/**
 * Module-level singleton for the active capability runtime loader. The
 * capabilities-http endpoints read this so activate/deactivate can
 * hot-load against the same loader the pickup-loop dispatches through.
 */
let activeCapabilityRuntimeLoader: CapabilityRuntimeLoader | undefined;

export function setActiveCapabilityRuntimeLoader(loader: CapabilityRuntimeLoader): void {
  activeCapabilityRuntimeLoader = loader;
}

export function getActiveCapabilityRuntimeLoader(): CapabilityRuntimeLoader | undefined {
  return activeCapabilityRuntimeLoader;
}

function snapshotLiveCapabilities(loader: CapabilityRuntimeLoader): LiveCapability[] {
  return loader.listLoaded().map((entry) => ({
    id: entry.id,
    summary: `Self-coded capability loaded from ${entry.activeDir}.`,
  }));
}

/**
 * If the operator has configured Gmail OAuth credentials (env vars or
 * keychain), wire the real email-handler worker. Otherwise fall back to
 * a friendly stub that tells the planner why email tasks can't run yet.
 *
 * The default account for v0.1 is read from GMAIL_DEFAULT_ACCOUNT. Tasks
 * may override per-call via `task.input.account = "alice@example.com"`.
 */
function buildEmailHandler(llm: LlmClient): ProjectWorker {
  const oauthConfig = resolveGmailOAuthClientConfig();
  if (!oauthConfig) {
    return async () => ({
      ok: false,
      error:
        "Gmail isn't connected yet. Set GMAIL_OAUTH_CLIENT_ID + GMAIL_OAUTH_CLIENT_SECRET, then run 'alien gmail connect <your-address@gmail.com>'.",
    });
  }
  const defaultEmail = (process.env.GMAIL_DEFAULT_ACCOUNT ?? "").trim();
  if (!defaultEmail) {
    return async () => ({
      ok: false,
      error:
        "Gmail credentials are set, but no default account is configured. Run 'alien gmail connect <your-address@gmail.com>' and set GMAIL_DEFAULT_ACCOUNT.",
    });
  }
  return createEmailHandlerWorker({ oauthConfig, defaultEmail, llm });
}

function overrideEmailHandler(
  registry: ProjectWorkerRegistry,
  emailHandler: ProjectWorker,
): ProjectWorkerRegistry {
  return { ...registry, "email-handler": emailHandler };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * The goal-loop handler that fires when a project's tasks have all reached
 * terminal states. Asks the evaluator whether the goal is met; if not,
 * re-fires the planner with the prior results as context. Iteration count
 * lives in `project.metadata.iteration` so it survives gateway restarts.
 *
 *   verdict: "achieved"   -> project.status = "achieved"
 *   verdict: "needs-more" -> planner emits next batch; iteration++
 *   verdict: "stuck"      -> project.status = "needs-input"
 */
function buildGoalLoopHandler(params: {
  projectsDir: string;
  llm: LlmClient;
  auditLogPath?: string;
}): (project: Project, tasks: readonly TaskRecord[]) => Promise<void> {
  const evaluatorOptions = { llm: params.llm, maxIterations: defaultMaxIterations() } as const;
  return async (project, tasks) => {
    try {
      const iteration = readIteration(project);
      const outcome = await evaluate(project, tasks, iteration, evaluatorOptions);
      if (params.auditLogPath) {
        emitProjectsAuditEvent(
          {
            kind:
              outcome.verdict === "achieved"
                ? "projects.project.goal_achieved"
                : outcome.verdict === "stuck"
                  ? "projects.project.stuck"
                  : "projects.project.iteration_started",
            payload: {
              projectId: project.id,
              iteration,
              verdict: outcome.verdict,
              feedback: outcome.feedback,
              ...(typeof outcome.costUsd === "number" ? { costUsd: outcome.costUsd } : {}),
            },
          },
          { auditLogPath: params.auditLogPath },
        );
      }
      if (outcome.verdict === "achieved") {
        saveProject(params.projectsDir, {
          ...project,
          status: "achieved",
          metadata: {
            ...(project.metadata ?? {}),
            iteration,
            lastEvaluation: outcome.feedback,
          },
        });
        return;
      }
      if (outcome.verdict === "stuck") {
        saveProject(params.projectsDir, {
          ...project,
          status: "needs-input",
          metadata: {
            ...(project.metadata ?? {}),
            iteration,
            lastEvaluation: outcome.feedback,
          },
        });
        return;
      }
      // needs-more: re-fire the planner. The new tasks make the project
      // non-idle, so the next tick won't re-trigger this handler.
      const nextIteration = iteration + 1;
      const fresh = loadProject(params.projectsDir, project.id);
      const projectAfter = fresh ?? project;
      const existing = listTasks(params.projectsDir, project.id);
      const planResult = await plan(
        {
          projectId: project.id,
          prompt: projectAfter.goal,
          origin: { kind: "planner", runId: `iter-${nextIteration}` },
          existing,
          priorContext: {
            iteration: nextIteration,
            goal: projectAfter.goal,
            evaluatorFeedback: outcome.feedback,
            priorResultsSummary: outcome.priorResultsSummary,
          },
        },
        {
          llm: params.llm,
          liveCapabilities: () => {
            const loader = getActiveCapabilityRuntimeLoader();
            return loader ? snapshotLiveCapabilities(loader) : [];
          },
        },
      );
      if (planResult.tasks.length === 0) {
        // Planner had nothing to add — treat as stuck so the operator can
        // step in instead of letting the loop spin forever.
        saveProject(params.projectsDir, {
          ...projectAfter,
          status: "needs-input",
          metadata: {
            ...(projectAfter.metadata ?? {}),
            iteration: nextIteration,
            lastEvaluation:
              "Evaluator wanted more work but the planner produced no new tasks. Operator needed.",
          },
        });
        return;
      }
      persistPlan(project.id, planResult, {
        projectsDir: params.projectsDir,
        origin: { kind: "planner", runId: `iter-${nextIteration}` },
        ...(params.auditLogPath ? { auditLogPath: params.auditLogPath } : {}),
      });
      saveProject(params.projectsDir, {
        ...projectAfter,
        metadata: {
          ...(projectAfter.metadata ?? {}),
          iteration: nextIteration,
          lastEvaluation: outcome.feedback,
        },
      });
    } catch (err) {
      logWarn(`goal-loop: handler failed for ${project.id}: ${stringifyError(err)}`);
    }
  };
}

function readIteration(project: Project): number {
  const raw = (project.metadata as Record<string, unknown> | undefined)?.iteration;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  return 0;
}
