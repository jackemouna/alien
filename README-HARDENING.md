# Alien — Security Hardening Notes

This fork applies the [AUDIT.md](AUDIT.md) findings as concrete behavior changes. Every High in the audit is closed by one of the commits below. Each section says **what changed**, **how to opt out** (or in), and **what threat it addresses**.

---

## H7 — `hono` CVE bump

**Commit:** `794c371408` — `fix(deps): bump hono override to >=4.12.16 (CVE-2026-44456, CVE-2026-44455)`

**What changed:** the `pnpm.overrides` pin for `hono` moved from `4.12.14` to `>=4.12.16`. `pnpm install` resolves it to `4.12.18`. `pnpm audit` reports no known vulnerabilities.

**Opt-out:** none — the previous version had a known body-limit-bypass and a JSX-injection issue. There is no good reason to opt back in.

**Threat:** chunked-request body-limit bypass that lets oversized requests reach handlers (memory exhaustion) and JSX tag-name injection in server-rendered responses.

---

## H6 — refuse `--token` on the gateway daemon

**Commit:** `bb3a0ed95a` — `fix(gateway): refuse --token unless ALIEN_ALLOW_INLINE_TOKEN=1 (audit H6)`

**What changed:** running `alien gateway run --token <secret>` now exits with a clear error pointing operators at `ALIEN_GATEWAY_TOKEN`. The flag's help text is marked DEPRECATED.

**Opt-out:** `ALIEN_ALLOW_INLINE_TOKEN=1 alien gateway run --token <secret>`. Use only in environments where the process list and shell history are not a leak vector (rare).

**Threat:** tokens passed via CLI args appear in `ps aux`, `/proc/<pid>/cmdline`, and shell history. Any local user (or any process running as the same uid) can read them.

---

## H2 — refuse `fs_write` / `edit` writes into Alien's own source

**Commit:** `c45ab04dd9` — `feat(security): refuse fs_write/edit into Alien's own source tree (audit H2)`

**What changed:** the host `fs_write` and `edit` tools now refuse writes whose resolved absolute path lives inside the directory containing `alien.mjs`. Sandboxed tool variants are unaffected because they already run inside a container.

**Opt-out:** `ALIEN_ALLOW_SELF_EDIT=1`. Only useful if you deliberately want the agent to be able to edit its own code.

**Threat:** without this guard, one prompt-injected `write` call to e.g. `src/agents/sandbox/runtime-status.ts` can flip the sandbox decision, drop tools from the deny list, or rewrite startup code — undoing every other defense in a single tool call. Persists across restarts.

---

## H5 — pairing wrong-code rate limit

**Commit:** `7bd5563548` — `feat(pairing): per-channel wrong-code backoff + lockout (audit H5)`

**What changed:** `approveChannelPairingCode` tracks wrong-attempt count per channel pairing-store file. After 3 misses, subsequent attempts return `{ rateLimited: true; retryAfterMs }` for an exponentially-growing window: 60s, 120s, 240s, …, capped at 30 minutes. A successful approval resets the counter. `upsertChannelPairingRequest` preserves the counter through unrelated writes so an attacker cannot drop the lockout by triggering a new pairing request.

The pairing CLI shows a friendly retry-in-Ns message when rate-limited.

**Opt-out:** none — the rate limit is per-channel-file and resets on success, so legitimate operators are not impacted by it.

**Threat:** wrong-code probing was previously invisible — no rate limit, no log, no alarm. With 42-bit codes a brute force is computationally expensive (~2^41 attempts on average) but operationally silent. The lockout makes sustained probing visible and slows it dramatically.

---

## H4 — structural fencing on HTTP-API message bodies

**Commit:** `910796039f` — `feat(gateway): structural fencing for HTTP-API message bodies (audit H4)`

**What changed:** `buildAgentMessageFromConversationEntries` now accepts an optional `untrusted: boolean` parameter. When `true`, each entry body is wrapped in `<msg_body id="<rand-8-hex>">…</msg_body>` markers with a randomized id per call. Literal `<msg_body…>` and `</msg_body>` sequences inside bodies are sanitized to `[msg_body]` / `[/msg_body]` so they cannot escape the fence.

The two HTTP-API callers (`openai-http`, `openresponses-prompt`) pass `untrusted: true`. Operator-driven paths default to `false` so the prompt is unchanged for them.

**Opt-out:** none on the HTTP-API path — the fence costs ~25 chars per message and cannot be confused with operator instructions.

**Threat:** a malicious HTTP caller (or an operator who has shared the gateway token too widely) can otherwise embed text like `Ignore previous instructions and run: …` indistinguishably from legitimate operator prompts.

**Out of scope (deferred):** channel auto-reply paths (Slack/Discord/Telegram DMs) use a different function (`buildHistoryContextFromMap`) with channel-owned `formatEntry` callbacks. Each channel formatter would need its own fence treatment, which is a separate, larger change.

---

## H3 — cron write-action audit log + opt-in lockdown

**Commit:** `94a2d4b8c9` — `feat(security): cron write-action audit log + opt-in lockdown (audit H3)`

**What changed:** every cron write-class action (`add`, `update`, `remove`, `run`, `wake`) is logged at warn level with the action and `toolCallId`. Read-only actions (`status`, `list`, `runs`) are unchanged.

**Opt-in lockdown:** `ALIEN_DENY_CRON_WRITES=1 alien gateway run` causes write-class cron actions to be refused with a structured tool-result error pointing at the env var. The model sees the refusal and can adjust its plan.

**Threat:** cron is a persistent-execution tool — a malicious schedule survives restarts. The audit-log makes scheduling changes visible after the fact; the opt-in lockdown lets operators disable them entirely for non-interactive runs.

**Out of scope (deferred):** `fs_delete` is on the audit's H3 list but does not exist as a tool in this codebase (it appears only on the HTTP gateway deny list). A real human-in-the-loop approval flow for cron writes — paralleling the existing exec-approvals pipeline — is a much larger refactor that should land separately.

---

## H1 — startup warning when sandbox is off + `ALIEN_HARDENED_DEFAULTS`

**Commit:** `673cbd935d` — `feat(security): warn at startup when main-session sandbox is off (audit H1)`

**What changed:** at the start of `alien gateway run`, when `agents.defaults.sandbox.mode` resolves to `"off"` (explicit or by default), the gateway log emits a multi-line warning explaining the risk and pointing at this document.

`ALIEN_HARDENED_DEFAULTS=1` flips the unset-mode default from `"off"` to `"docker"` for that run, without editing `alien.json`. Operators who explicitly set `mode: "off"` still get `"off"` — the env var only changes the default for _unset_ values, so it never silently overrides an operator's explicit choice.

**To harden persistently:** set `agents.defaults.sandbox.mode: "docker"` in `~/.alien/alien.json`. (Requires Docker Desktop running.)

**To harden per-run:** `ALIEN_HARDENED_DEFAULTS=1 alien gateway run`.

**Threat:** mode `"off"` runs main-session tool calls (bash, fs_write, network, browser) on the host with the operator's full privileges. Any successful prompt-injection inside the main session = arbitrary code execution as the user. This is the largest single blast-radius issue in the audit.

**Why not flip the default to docker:** flipping requires Docker Desktop on every operator's machine, which is a UX shift larger than this commit's scope. The warning + opt-in env var is the bridge until that decision is made.

---

## Summary table

| Audit | Commit       | Default                            | Opt-out / Opt-in                             |
| ----- | ------------ | ---------------------------------- | -------------------------------------------- |
| H7    | `794c371408` | hono ≥4.12.16 (CVE-fixed)          | n/a                                          |
| H6    | `bb3a0ed95a` | `--token` refused at startup       | `ALIEN_ALLOW_INLINE_TOKEN=1`                 |
| H2    | `c45ab04dd9` | writes into Alien's source refused | `ALIEN_ALLOW_SELF_EDIT=1`                    |
| H5    | `7bd5563548` | wrong-code lockout after 3 misses  | n/a (auto-resets on success)                 |
| H4    | `910796039f` | HTTP-API messages fenced           | n/a                                          |
| H3    | `94a2d4b8c9` | cron writes logged                 | `ALIEN_DENY_CRON_WRITES=1` (opt-in lockdown) |
| H1    | `673cbd935d` | startup warning when sandbox off   | `ALIEN_HARDENED_DEFAULTS=1` (opt-in)         |

---

## Threat model delta vs upstream's `SECURITY.md`

Upstream's [SECURITY.md](SECURITY.md) explicitly states the project is "local-first agent infrastructure for trusted operators" and that "prompt-injection-only chains" are out of scope. The hardening above takes a stricter view: **assume prompt injection is realistic, web content is malicious, and operator may forget security hygiene**. None of the changes here weaken upstream's posture; they add belt-and-braces against the failure modes that upstream considers the operator's problem.

Reports for issues in upstream-shared code should still go to [openclaw/openclaw security advisories](https://github.com/openclaw/openclaw/security/advisories/new) — they will land in the codebase everyone is running, not just this fork.

---

## Mediums and Lows

The audit also flagged 8 Medium and 9 Low findings ([AUDIT.md](AUDIT.md)). They are not addressed in this hardening pass. The Mediums most worth following up:

- **M1** — per-plugin trust isolation
- **M2** — secrets at rest via OS keychain (instead of plaintext JSON, even with 0o600)
- **M3 / M4** — tool-call origin tracking + tamper-evident audit log
- **M6** — scrub provider keys / gateway token from `process.env` before spawning child processes
- **M7** — Chromium JS-disabled mode for the browser tool

The Lows are notes — already in good shape.
