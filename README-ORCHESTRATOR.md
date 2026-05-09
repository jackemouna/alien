# Alien — Orchestrator MVP

Multi-agent coordinator for autonomous business workflows. The first concrete vertical is **daily-research**: a research → write → edit → publish DAG that produces a markdown newsletter from a topic list.

## What it is

A small, hardenable foundation for the "office of expert agents" pattern: a planner builds a task graph, a runner walks tasks one at a time, each task is executed by a specialist worker, state is persisted after every transition (crash-resumable), every event is recorded in the existing tamper-evident audit log with origin tags from M3.

Layout:

```
src/orchestrator/
├── types.ts                       — WorkerRole, Task, Run, Worker contract
├── run-state.ts                   — pure state-machine helpers
├── run-store.ts                   — disk persistence (0o700 dir / 0o600 file)
├── llm-client.ts                  — minimal LlmClient interface + Anthropic impl
├── workers.ts                     — researcher / writer / editor / publisher
├── runner.ts                      — walks the task graph + emits audit-log
└── workflows/
    └── daily-research.ts          — concrete plan generator for the first vertical
```

## Daily-research DAG

```
[research:0] ──▶ [write:0] ──┐
[research:1] ──▶ [write:1] ──┤
   …                  …       ├──▶ [edit] ──▶ [publish]
[research:N] ──▶ [write:N] ──┘
```

Sequential execution: the runner takes one runnable task per tick. Parallelism is a follow-up.

## Run it

```bash
# One-off run, output to a default location under ~/.alien/orchestrator/runs/
ANTHROPIC_API_KEY=sk-ant-... \
  alien security orchestrator-run \
    --topics "WebAssembly,Bun,Rust async runtimes" \
    --title "Tuesday Brief"

# Custom output, override model + word target
ANTHROPIC_API_KEY=sk-ant-... \
  alien security orchestrator-run \
    --topics "agentic IDEs" \
    --output ~/Desktop/agentic-ides.md \
    --model claude-sonnet-4-6 \
    --word-target 200

# Machine-readable result (for piping into jq / monitoring)
alien security orchestrator-run --topics "x,y" --json
```

Run state persists at `~/.alien/orchestrator/runs/<runId>.json`. Audit-log events at `~/.alien/audit.log` (the same file the security guards write to).

Inspect the audit log:

```bash
alien security audit-log --tail 30
```

You'll see entries like `orchestrator.run.started`, `orchestrator.task.started`, `orchestrator.task.succeeded`, `orchestrator.run.succeeded`, each tagged with `origin: operator` (or `origin: channel:slack` if a channel handler eventually triggers a run).

## Resume from crash

Each task transition writes the full Run snapshot to disk _before_ the next worker starts. If the process dies mid-run, the persisted state carries every dependency output the next task needs. Re-invoking the runner with the loaded Run picks up at the first pending task — no work is repeated.

The MVP CLI does not yet expose `--resume <runId>`; the building block is in place (`loadRun(orchestratorDir, runId)`), the CLI surface is a follow-up.

## Adding a new workflow vertical

The pattern generalizes. To add e.g. `youtube-shorts`:

1. Define `src/orchestrator/workflows/youtube-shorts.ts` with a `planYouTubeShortsWorkflow(config)` that returns a `WorkflowDefinition`.
2. If new specialist roles are needed (e.g. `script-writer`, `video-renderer`), add them to the `WorkerRole` union in `types.ts` and create matching workers.
3. Wire the new plan into the CLI (or a new subcommand).

The runner, run-store, and audit-log integration are all generic — they don't know about daily-research specifically.

## What's deliberately not yet here

- **Parallelism** — the runner takes one runnable task at a time. Easy to extend to "all currently-runnable" but needs careful retry semantics and per-worker rate-limit coordination.
- **Cron** — `alien security orchestrator-run` is one-shot. Pair with `alien cron add` (the existing cron tool) or systemd/launchd to schedule daily runs.
- **Rich tool use in workers** — the MVP workers each make a single LLM call. Real workers need browsing, file reading, image generation, etc. The `Worker` interface accepts any `(input) => Promise<output>`; richer workers plug in unchanged from the runner's perspective.
- **Per-workflow config files** — topics are passed via `--topics` for now. A `~/.alien/orchestrator/workflows/<id>.json` config + reload command is a small follow-up.
- **Approval gates** — the runner runs every task without operator confirmation. Adding a `tools.<role>.ask` config (mirroring the exec-approvals pattern) is straightforward.
- **Cost guardrails** — no per-run token budget yet. Important before unattended daily operation; should land before the first cron-driven run.

## Audit-log event reference

Every run emits this sequence (assuming success):

| Kind                          | When                                  | Payload fields                    |
| ----------------------------- | ------------------------------------- | --------------------------------- |
| `orchestrator.run.started`    | runner entry                          | runId, workflowId, taskCount      |
| `orchestrator.task.started`   | per task                              | runId, taskId, role, attempts     |
| `orchestrator.task.succeeded` | worker ok=true                        | runId, taskId, role               |
| `orchestrator.task.failed`    | worker ok=false / threw               | runId, taskId, role, error        |
| `orchestrator.run.succeeded`  | every task succeeded                  | runId, workflowId, tasksAttempted |
| `orchestrator.run.failed`     | a task failed and no progress remains | runId, workflowId, tasksAttempted |
| `orchestrator.run.aborted`    | options.signal aborted                | runId                             |

Every entry carries `origin` / `originUntrusted` / `originDetails` from `currentOrigin()`.
