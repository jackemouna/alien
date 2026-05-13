# Audit log

Every meaningful action your Alien takes is recorded in a tamper-evident
log at `~/.alien/audit.log`. Hash-chained JSONL. Append-only from code.
Tampering with past entries breaks the chain in a detectable way.

This page explains what's logged, how the chain works, and how to read
and verify the file.

## What's logged

Every state transition that touches an external boundary, a credential,
or your data:

- **Projects/Tasks** — every create, queue, claim, complete, fail, block,
  approve, archive (`projects.project.*`, `projects.task.*`).
- **Orchestrator** — every run start/finish (`orchestrator.run.*`).
- **Cron** — every add/update/remove/run (`cron.add`, `cron.run`, etc.).
- **Tool exec** — refused dangerous commands, allowed exec calls
  (`exec.dangerous`, `self_edit.allowed`, `self_edit.refused`).
- **Channel sends** — every outbound message (`sessions.send`).
- **Pairing** — rate-limited approval attempts (`pairing.rate_limited`).
- **Gateway** — token-inline refusals (`gateway.token_inline_refused`).
- **FS writes** — blocked writes outside the policy
  (`fs_write.blocked`).

Reading data is not logged. We don't follow `gmail.read_inbox` calls
into the log because that would itself leak inbox contents into the log
file. The fact that a worker ran is logged; the inbox payload is not.

## Entry shape

Each line is one JSON object:

```json
{
  "ts": "2026-05-12T19:48:30.558Z",
  "kind": "projects.task.claimed",
  "payload": {
    "projectId": "proj-abc",
    "taskId": "task-abc-0",
    "role": "writer",
    "status": "in-progress",
    "priority": "normal",
    "attempts": 1,
    "origin": {
      "kind": "operator"
    }
  },
  "prevHash": "fa8b3e…(64 hex)",
  "hash": "9c7102…(64 hex)"
}
```

- `ts` — ISO 8601 timestamp.
- `kind` — short event identifier.
- `payload` — event-specific fields. Secrets are redacted via the
  M8 redaction layer before they reach the audit log.
- `prevHash` — the `hash` field of the previous entry (empty for the
  first).
- `hash` — `sha256(prevHash || canonicalJson({ts, kind, payload, prevHash}))`.

The hash chain means: if anyone modifies, inserts, or deletes a past
line, every subsequent entry's recorded `hash` no longer matches the
recomputed value. Verification catches it.

## Reading the log

The log is plain JSONL — any tool that reads line-delimited JSON works.
A handful of useful one-liners:

```bash
# Last 20 entries, pretty-printed:
tail -20 ~/.alien/audit.log | jq .

# All task transitions for a specific project:
grep '"projectId":"proj-abc"' ~/.alien/audit.log | jq -r \
  '[.ts, .kind, .payload.taskId, .payload.status] | @tsv'

# Every channel-originated task in the last 24 hours:
jq -c 'select(.ts > (now - 86400 | todate))
       | select(.payload.origin.kind == "channel")' ~/.alien/audit.log

# Count of each event kind:
jq -r .kind ~/.alien/audit.log | sort | uniq -c | sort -rn
```

If a project misbehaves, the audit log is usually the fastest path to
"what actually happened, in order." Search for the `projectId` and read
top-to-bottom.

## Verifying the chain

```bash
pnpm alien security audit-log verify
```

Returns one of:

- `audit log ok: <N> entries` — the chain checks out end-to-end.
- `audit log broken at line <i>: <reason>` — one of:
  - **`prevHash mismatch`** — a line's `prevHash` doesn't match the
    previous line's `hash`. Either an entry was inserted/deleted, or
    `prevHash` was edited.
  - **`hash does not match recomputed chain value`** — a line's
    contents were edited but the `hash` was not (correctly) updated.
  - **`line is not valid JSON`** — a line is corrupt. Most commonly
    a write was interrupted (kill -9, disk full, sudden power loss).

The break index tells you the **first** line where the chain fails.
Earlier entries up to that point are intact.

## What to do when the chain breaks

A chain break is a signal, not a panic. Most breaks have a benign cause:

1. **Sudden power loss / kill -9.** The last line may be truncated.
   Open the file in an editor; if the last line ends mid-JSON, delete
   it. Re-run verify; if it now reports ok with one fewer entry,
   that's the explanation. The runtime is resilient to a missing tail
   entry.
2. **Hand-editing.** Did you (or another tool) open the log and edit
   it? Reverting to the backup at `~/.alien/audit.log.bak` (if you've
   started taking snapshots) is the cleanest fix.
3. **Genuine tampering.** If neither of the above explains it, treat
   it as a security event:
   - Capture the current state of `~/.alien/` (snapshot the whole
     directory).
   - Stop the gateway.
   - File a private security advisory at
     [github.com/jackemouna/alien/security/advisories/new](https://github.com/jackemouna/alien/security/advisories/new)
     with the verify output and the entries around the break.

The audit log doesn't prevent tampering — it makes tampering visible.
That's the design.

## Size management

The log grows append-only. For an active install with multiple projects,
it can reach the tens of MB within a few weeks.

Pruning is **deliberately manual**. We don't auto-rotate because:

- Rotation breaks the chain (a new file starts a new chain).
- A naive "delete entries older than X" silently destroys evidence.

If you need to roll the log:

```bash
# 1. Stop the gateway.
# 2. Verify the chain on the current file first:
pnpm alien security audit-log verify

# 3. Archive the current log (keep it — that's the historical record):
mv ~/.alien/audit.log ~/.alien/audit.log.$(date +%Y%m%d)

# 4. Restart the gateway. A fresh chain starts on next write.
```

The archived file remains verifiable as a self-contained chain. The new
chain starts at line 1 with `prevHash: ""`.

## Where the writes come from

If you want to trace why a specific entry exists:

- `src/security/audit-log.ts` — the core `appendAuditLog()`.
- `src/projects/audit.ts` — the `projects.*` emitters.
- `src/orchestrator/runner.ts` — the `orchestrator.*` emitters.
- `src/agents/alien-tools.*` wrappers — `exec.*`, `self_edit.*`,
  `fs_write.*`.
- `src/pairing/pairing-store.ts` — `pairing.rate_limited`.
- `src/cli/gateway-cli/run.ts` — `gateway.token_inline_refused`.

Adding a new emit-site is a four-line PR: import `appendAuditLog`,
call it with `{kind, payload}` after the action, optionally add an
entry to the `AuditEntryKind` union.

## What's NOT in the log

- The contents of inbox messages, drafts, channel DMs, or LLM
  conversations.
- API keys, OAuth tokens, refresh tokens. The M8 redaction layer
  scrubs these before they reach the log.
- Read-only operations (listing tasks, fetching project state).
- UI interactions (button clicks, page views).

If you need a query against the _full_ event stream including
read-only ops, that's an observability concern (logs, traces) rather
than an audit one. See `~/.alien/logs/` for the gateway's runtime
log, which is _not_ hash-chained and _is_ mutable.
