# Projects + the workforce model

This is how the AI team actually works: how a prompt becomes tasks, how
workers claim them, how big actions wait for your approval, and where the
audit log fits in.

## The mental model

Think of an Alien install like a tiny company:

- **You** are the operator. You set goals, approve big actions, and watch
  the work happen.
- **The planner** is the AI "CEO". When you give it a goal it breaks the
  goal into a small set of tasks and assigns each to a specialist.
- **The workers** are specialists: researcher, writer, editor, publisher,
  email-handler. Each one knows how to do one kind of work.
- **The board** is your Kanban view. Every task lives in one of seven
  columns; you can see the whole company at a glance.
- **The auto-pickup loop** is the cadence. Every 2.5 seconds, idle workers
  scan the board and claim the next task they're qualified for.

Nothing happens you don't see. Every state change is logged.

## The columns

| Column              | When a task lives here                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Needs your OK**   | The planner marked this task as needing approval (usually because it has external side effects like sending email). It won't be picked up until you approve. |
| **Up next**         | Ready to be claimed. Dependencies have all completed.                                                                                                        |
| **Working on it**   | A worker has claimed this task and is running it right now.                                                                                                  |
| **For your review** | The worker finished but wants you to look before the result is final (e.g. a draft email).                                                                   |
| **Done**            | Finished. Downstream tasks may now move.                                                                                                                     |
| **Stuck**           | You paused this task. It won't be picked up until you retry.                                                                                                 |
| **Didn't work**     | The worker failed. Click **"Try again"** to put it back in **Up next**.                                                                                      |

## Approval gates

The planner is told (in its system prompt) to mark tasks as needing
approval when their action is **destructive or visible to the outside
world**. Reading data, drafting, summarizing, saving to your own disk —
all unapproved by default. Sending email, posting to a channel,
publishing — approval required.

You can override either direction:

- **Approve a backlog task**: click "Looks good — go" on the card.
- **Make a queued task wait**: click "Pause" → it lands in **Stuck**
  with the reason you typed.

There's no global "approve everything" toggle. Approvals are intentionally
per-task so you stay in the loop.

## How a prompt becomes tasks

1. You type into the "What should your team work on?" box (or DM the
   bot on a project-bound Slack channel, or run a starter template).
2. The planner agent (Claude Sonnet 4.6 by default) gets the prompt,
   the existing tasks on the board (so it doesn't duplicate), and the
   list of available worker roles.
3. It responds with a strict JSON plan: a list of tasks with titles,
   descriptions, roles, dependencies, and priorities.
4. Each task is validated, assigned a stable id, and persisted to disk
   (`~/.alien/projects/<projectId>/tasks/<taskId>.json`, mode `0o600`).
5. Tasks without dependencies move straight to **Up next**. Tasks marked
   `requiresApproval: true` go to **Needs your OK**.

The planner is _forward-looking_: it doesn't try to do the work itself,
it just shapes the plan. The workers do the work.

## How the auto-pickup loop works

Every project has a per-project file lock at
`~/.alien/projects/<projectId>/.tasks.lock`. The pickup loop:

1. Lists active projects.
2. For each project, for each worker role, asks "is there an eligible
   task for you?"
3. **Eligible** = status is "Up next", not claimed by anyone, and every
   task it depends on is "Done".
4. Within eligibility, priority order is `urgent → high → normal → low`,
   then oldest-first within a priority band.
5. Claiming is race-safe: the loop reads → picks → writes → releases the
   lock atomically. Two workers can't claim the same task even if they
   race.
6. Once claimed, the loop runs the worker with the task's input and the
   outputs of its dependencies.
7. The worker's result moves the task to **Done** (or **For your
   review**, or **Didn't work**).

The loop runs in-process inside the gateway. It starts on first contact
with the `/v1/projects` HTTP route (or on gateway boot once that wiring
lands).

## What each worker does

| Role              | Behavior                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **researcher**    | One LLM call. Produces 4–6 concise factual bullet points about the supplied topic. Marks uncertain claims with `[unverified]`.                                                  |
| **writer**        | One LLM call. Turns research notes into a prose summary of the requested word target. No headings, no bullets, no marketing speak.                                              |
| **editor**        | One LLM call. Takes drafts from upstream writers and combines them into a single polished document with the requested title.                                                    |
| **publisher**     | Writes the editor's output to disk at the configured path. No LLM call.                                                                                                         |
| **email-handler** | Three actions: `list_inbox` (return recent messages), `send` (post a new message), `draft_reply` (create a Gmail draft with an LLM-generated body, marked **For your review**). |

Workers are intentionally small. The pattern is "one LLM call per worker
unless you have a specific reason." Anything more complicated belongs in
a new worker role or a dedicated integration module.

## Task lifecycle in detail

```
                  ┌──── (planner emits) ────┐
                  ▼                         │
       (requiresApproval=true)            (no approval needed)
                  │                         │
            Needs your OK                Up next
                  │                         │
            (you click                      │
            "Looks good — go")              │
                  └────────► Up next ◄──────┘
                                  │
                          (worker claims)
                                  │
                          Working on it
                                  │
              ┌──────────────────┼───────────────────┐
              │                  │                   │
            (worker            (worker             (worker
            ok=true,           ok=true,            ok=false)
            toReview=true)     toReview=false)        │
              │                  │                   │
        For your review        Done             Didn't work
              │                  │                   │
       (you approve              │              (you click
        downstream)              │             "Try again")
              │                  │                   │
              └──────────────────┴──── Up next ◄─────┘

You can move any task to Stuck (paused) at any time.
You can retry Stuck or Didn't work tasks by clicking "Try again".
```

## Persistence + audit

Project state lives at `~/.alien/projects/<projectId>/`:

```
project.json            — name, goal, owner, status, channel bindings
tasks/<taskId>.json     — one file per task (status + output)
.tasks.lock             — claim lock (managed by the loop)
```

Every state transition emits a hash-chained entry to
`~/.alien/audit.log`. Each entry includes:

- `kind` (e.g. `projects.task.claimed`, `projects.task.failed`)
- `payload` with `projectId`, `taskId`, `role`, `attempts`, and the
  task's `origin` (channel / planner / operator)
- `prevHash` and `hash`, so tampering with past entries breaks the chain
  detectably

Verify the chain at any time with `alien security audit-log verify`.

## Channels as inboxes

A project can have one or more attached channels. When an inbound DM
arrives on a bound channel (Slack today; Discord/Telegram/etc. inherit
the same hook):

1. The channel plugin's existing dispatch runs as normal (auto-reply may
   answer too — see below).
2. Core's inbound-listener fires; the project router scans active
   projects for a binding that matches `{ channel, accountId }`.
3. On a match, the planner runs with `origin.kind = "channel"` and the
   sender's display name carried through.
4. Tasks land on the project board with that channel origin.
5. When a worker finishes, the pickup loop posts the result to the same
   thread (Slack thread, Discord reply, etc.).

If you want a Slack channel to be **project-only** (no chat auto-reply),
turn off the chat-side responder for that channel via existing channel
config.

## Cost model

Each worker run is one LLM call (planner is an additional call). A daily
brief with 3 topics is roughly: 1 planner + 3 researchers + 3 writers + 1
editor + 1 publisher = 8 LLM calls. With Sonnet 4.6 and short prompts
that's well under a cent per run. Email drafts add one call per draft.

Per-run token budgets are a documented v0.2 hardening item.

## Extending

Adding a new worker role is a four-step pattern:

1. Add the role to `WorkerRole` in `src/orchestrator/types.ts`.
2. Build the worker as a `ProjectWorker` (see
   `src/integrations/gmail/worker.ts` for a real example).
3. Wire it into the registry in `src/gateway/projects-runtime.ts`.
4. Update the planner's system prompt so it knows when to dispatch to
   the new role.

The same pattern works for new integrations beyond Gmail (Calendar,
Notion, GHL, etc.) — see [CONTRIBUTING.md](../CONTRIBUTING.md).
