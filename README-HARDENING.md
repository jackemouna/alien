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

| Audit | Commit       | Default                              | Opt-out / Opt-in                             |
| ----- | ------------ | ------------------------------------ | -------------------------------------------- |
| H7    | `794c371408` | hono ≥4.12.16 (CVE-fixed)            | n/a                                          |
| H6    | `bb3a0ed95a` | `--token` refused at startup         | `ALIEN_ALLOW_INLINE_TOKEN=1`                 |
| H2    | `c45ab04dd9` | writes into Alien's source refused   | `ALIEN_ALLOW_SELF_EDIT=1`                    |
| H5    | `7bd5563548` | wrong-code lockout after 3 misses    | n/a (auto-resets on success)                 |
| H4    | `910796039f` | HTTP-API messages fenced             | n/a                                          |
| H3    | `94a2d4b8c9` | cron writes logged                   | `ALIEN_DENY_CRON_WRITES=1` (opt-in lockdown) |
| H1    | `673cbd935d` | startup warning when sandbox off     | `ALIEN_HARDENED_DEFAULTS=1` (opt-in)         |
| M5    | `c3e94da647` | warn when `~/.alien` perms loose     | n/a                                          |
| M6    | `f4bddb2092` | secrets scrubbed from child env      | `ALIEN_NO_SCRUB_CHILD_ENV=1`                 |
| M4    | `27a996d60f` | cron events to audit.log (chained)   | `ALIEN_DISABLE_AUDIT_LOG=1`                  |
| M2    | `f464ffc4f5` | OS keychain helper (no migration)    | n/a (building block)                         |
| M8    | `f53c708f14` | redact AWS/Stripe/Google/Azure/JWT   | n/a                                          |
| M7    | `07911821d8` | browser `--disable-javascript`       | `ALIEN_BROWSER_DISABLE_JS=1` (opt-in)        |
| M2.1  | `51d936f551` | gateway token from OS keychain       | `ALIEN_GATEWAY_TOKEN_KEYCHAIN=1` (opt-in)    |
| H4.2  | `c8c61af423` | channel-DM bodies fenced (envelope)  | `ALIEN_FENCE_CHANNEL_DMS=1` (opt-in)         |
| M3    | `287eb61c40` | tool-call origin in audit log        | n/a (uses AsyncLocalStorage)                 |
| M2.2  | `c8ffa23e6d` | env-or-keychain secret resolver      | `ALIEN_SECRETS_FROM_KEYCHAIN=1` (opt-in)     |
| M3.1  | `5cd21f4a95` | runAsHttp wired into HTTP-API        | n/a                                          |
| M4.1  | `e6807b0e98` | audit-log self-edit attempts         | `ALIEN_DISABLE_AUDIT_LOG=1`                  |
| M3.2  | `8bbb6a3617` | runPreparedReply tags channel origin | n/a                                          |
| M3.3  | `1fb2c4b4e1` | runCli tags operator origin          | n/a                                          |
| M4.2  | `2f58657f1f` | audit-log sessions_send              | `ALIEN_DISABLE_AUDIT_LOG=1`                  |
| M4.3  | `9e1c805d1b` | audit-log H6 --token rejection       | `ALIEN_DISABLE_AUDIT_LOG=1`                  |

---

## Threat model delta vs upstream's `SECURITY.md`

Upstream's [SECURITY.md](SECURITY.md) explicitly states the project is "local-first agent infrastructure for trusted operators" and that "prompt-injection-only chains" are out of scope. The hardening above takes a stricter view: **assume prompt injection is realistic, web content is malicious, and operator may forget security hygiene**. None of the changes here weaken upstream's posture; they add belt-and-braces against the failure modes that upstream considers the operator's problem.

Reports for issues in upstream-shared code should still go to [openclaw/openclaw security advisories](https://github.com/openclaw/openclaw/security/advisories/new) — they will land in the codebase everyone is running, not just this fork.

---

## Mediums (Phase 7–10)

A second hardening pass closed four of the eight Mediums:

### M5 — startup warning when `~/.alien/` perms are loose

**Commit:** `c3e94da647` — `feat(security): warn at startup when ~/.alien perms are loose (audit M5)`

**What changed:** at `alien gateway run` startup, if `~/.alien` has mode bits looser than `0o700` (group- or world-readable / world-writable), the gateway log emits a warning identifying the actual mode, the exposure class, and a `chmod 700` fix. Skipped on Windows (POSIX bits don't apply) and when the directory doesn't exist yet.

**Threat:** code that creates `~/.alien` always passes `0o700`, but the directory may pre-exist with looser perms (umask, manual `chmod`, migration from upstream openclaw). Once it exists, nothing re-tightens it, and it holds plaintext channel tokens, OAuth credentials, and provider API keys.

### M6 — scrub secret env vars from exec-tool child shells

**Commit:** `f4bddb2092` — `feat(security): scrub secret env vars from exec-tool child shells (audit M6)`

**What changed:** the `exec` tool's host-shell path drops Alien-/provider-secret env vars from the inherited environment before passing it to the spawned shell. Detection is by explicit prefix list (~50 services from the upstream `.env.example`) plus a generic `(?:TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)` pattern. PATH, HOME, LANG, etc. are preserved. Operators who need a specific var in shell calls can pass it via the tool-level `env` override.

**Opt-out:** `ALIEN_NO_SCRUB_CHILD_ENV=1` for backward compat with shell scripts that depend on env-var inheritance.

**Threat:** without scrubbing, a successful prompt-injection that runs any fragment of `printenv` / `env` / `set` (or pipes those into `curl`) exfiltrates every credential the operator has configured.

### M4 — hash-chained tamper-evident audit log

**Commit:** `27a996d60f` — `feat(security): hash-chained tamper-evident audit log (audit M4)`

**What changed:** new helpers `appendAuditLog` / `verifyAuditLog` write JSONL entries at `<state-dir>/audit.log` where each line includes the sha256 hash of the previous line. Tampering (edit, insert, delete) breaks the chain at every later entry. The cron-guard wires this in for write-class actions; broader integration is deliberate follow-up.

**Opt-out:** `ALIEN_DISABLE_AUDIT_LOG=1`.

**Threat:** the existing `ws-log` is for debugging, not forensics. An attacker who can write files can edit it to hide tracks. The chain doesn't _prevent_ tampering, but makes it visible after the fact.

**Honest limitation:** an agent with shell access can `rm ~/.alien/audit.log` and start a fresh chain. Stronger guarantees require an append-only mount or shipping events off-host. Out of scope here.

### M2 — macOS Keychain / Linux libsecret helper (building block only)

**Commit:** `f464ffc4f5` — `feat(security): macOS Keychain / Linux libsecret helper (audit M2 building block)`

**What changed:** new helper module `src/security/os-keychain.ts` wraps macOS `security` CLI (`add-generic-password` / `find-generic-password` / `delete-generic-password`) and Linux libsecret (`secret-tool store/lookup/clear`). Returns `unavailable` on Windows and headless servers without the CLI.

**Scope:** building block only. Migrating the existing secret paths (`src/secrets/shared.ts`, channel/provider auth profiles) to use it is deliberate follow-up — the migration changes how every secret is stored and needs careful handling for operators with existing installs.

**Threat:** even with 0o600 file mode, plaintext secrets are readable by any same-uid process — a Time Machine backup, a Dropbox sync agent, a misbehaving package. The OS keychain gates access on the user's login session.

---

## Phases 11–13 (a third pass)

### M8 — extend log-redaction patterns

**Commit:** `f53c708f14` — `feat(logging): extend redact patterns with AWS, Stripe, Google, Azure, JWT (audit M8)`

**What changed:** the default `redactSensitiveText` pattern set gained 8 high-value formats: AWS access keys (`AKIA…` and STS `ASIA…`), Stripe live/test/restricted keys (`sk_live_*`, `sk_test_*`, `rk_live_*`), Google OAuth tokens (`ya29.…`), Azure Storage `AccountKey=…`, and JWTs (three base64url segments). The Azure pattern masks only the value, keeping the field-name visible in diagnostics.

**Threat:** these formats show up unredacted in stack traces, HTTP-error diagnostics, and tool-result strings today. The existing `sk-` / `ghp_` / `xox-` prefix set didn't catch them.

### M7 — opt-in `--disable-javascript` for the browser tool

**Commit:** `07911821d8` — `feat(browser): opt-in --disable-javascript for the browser tool (audit M7)`

**What changed:** `ALIEN_BROWSER_DISABLE_JS=1` adds `--disable-javascript` to the Chromium launch flags. Pages can still be scraped (DOM is parsed) but cannot run scripts that exfiltrate local resources or attempt local-network probes through `fetch`/`WebSocket`.

**Default:** unchanged (JS still runs). The browser plugin's existing SSRF policy (no private network, allowlist required, IP-literal-only-when-strict) remains in effect on every navigation.

**Threat:** even with SSRF blocked at navigation time, a fetched page's JavaScript can still attempt `postMessage` tricks against embedded iframes or run prompt-injection content that lands via the model's tool-result rendering. JS-disabled mode closes that surface entirely.

### M2 (gateway-token slice) — keychain-backed gateway token, opt-in

**Commit:** `51d936f551` — `feat(security): keychain-backed gateway token (opt-in, audit M2 slice)`

**What changed:** when `ALIEN_GATEWAY_TOKEN_KEYCHAIN=1` is set, `ensureGatewayStartupAuth` consults the OS keychain (entry `alien-gateway / token`) before generating a fresh token. Newly generated tokens are also stored in the keychain so subsequent restarts find them there. Keychain failures are logged-and-ignored — startup is never blocked on keychain access.

**Operator workflow:**

```bash
# First run with the env var: token is generated, stored in keychain,
# AND mirrored into ~/.alien/alien.json (existing behavior).
ALIEN_GATEWAY_TOKEN_KEYCHAIN=1 alien gateway run

# To rotate: clear from keychain, delete from alien.json, restart.
security delete-generic-password -s alien-gateway -a token   # macOS
secret-tool clear service alien-gateway account token        # Linux

# Subsequent runs read from keychain only (when alien.json has no token).
```

**Default:** unchanged. Operators who never set the env var see the existing config-file-only persistence path.

**Threat:** the gateway token is the highest-value secret in the install — any process with read access to `~/.alien/alien.json` (a backup tool, sync agent, misbehaving package) can hijack the gateway. Keychain gating on the user's login session removes that surface.

**Scope:** gateway token only. Channel tokens, OAuth credentials, and provider keys remain in their existing JSON paths — migrating each is per-source follow-up work (the generic resolver below makes that incremental).

---

## Phases 14–16 (a fourth pass)

### H4 (channel slice) — opt-in fencing for inbound channel DMs

**Commit:** `c8c61af423` — `feat(envelope): opt-in fencing for inbound channel-message bodies (audit H4 channel slice)`

**What changed:** the central inbound-channel formatter `formatInboundEnvelope` (used by every channel auto-reply path: Slack, Discord, Telegram, Feishu, Mattermost, MS Teams, Zalo, qqbot, …) now wraps the body in `<msg_body id="…">…</msg_body>` markers when `ALIEN_FENCE_CHANNEL_DMS=1` is set. Default off so existing operators with prompts that depend on the envelope format are unaffected. Literal markers in the body are sanitized to `[msg_body]` form.

The HTTP-API path is fenced unconditionally (separate from this knob, see H4 above).

**Threat:** without the fence, a Slack/Discord/Telegram DM containing `Ignore previous instructions and …` is indistinguishable from operator instructions in the prompt the model sees.

### M3 — tool-call origin tracking via AsyncLocalStorage

**Commit:** `287eb61c40` — `feat(security): tool-call origin tracking via AsyncLocalStorage (audit M3)`

**What changed:** new module `src/security/origin-context.ts` holds a per-async-context `OriginContext` in `AsyncLocalStorage`. The cron-guard's audit-log payload now records `origin`, `originUntrusted`, and `originDetails`. Convenience runners `runAsOperator` / `runAsChannel(kind, …)` / `runAsHttp(endpoint, …)` let gateway entry points tag the origin once when a request lands.

**Default:** code paths that have not yet been instrumented record `origin: "unknown"` — still a useful signal in the audit log.

**Threat:** without origin tracking, post-incident logs can't answer "did the agent run this because I asked, or because a DM/webpage said to?". Combined with the M4 hash chain, the audit log now tells that story.

**Scope:** infrastructure + cron-guard wire-in. Instrumenting HTTP-API handlers, channel auto-reply paths, and the operator CLI/TUI to call the convenience runners is incremental follow-up.

### M2 (broader migration slice) — generic env-or-keychain resolver

**Commit:** `c8ffa23e6d` — `feat(security): generic env-or-keychain secret resolver (audit M2 building block)`

**What changed:** new helper `resolveSecretFromEnvOrKeychain` reads a secret from `process.env` first and, if absent, falls back to the OS keychain. Two gating modes: `"global-flag"` (only consults keychain when `ALIEN_SECRETS_FROM_KEYCHAIN=1`), or `"always"` for per-secret wrappers with their own opt-in.

**Pattern adopted by `gateway-token-keychain.ts`** with its own `ALIEN_GATEWAY_TOKEN_KEYCHAIN=1` flag. Channel and provider auth paths can adopt the same pattern incrementally — pick a service/account identifier, switch the read site to use the resolver, ship.

**Threat:** every secret still in plaintext JSON is readable by any same-uid process. The generic resolver shrinks the migration cost per secret to "rename the read call" rather than "redesign the auth path".

---

## Phases 17–19 (instrumentation pass)

Phases 9, 14, 15, 16 shipped _infrastructure_. This pass wires the infrastructure into actual entry points so the audit log captures real signal instead of `origin: "unknown"`.

### M3 instrumentation (HTTP-API)

**Commit:** `5cd21f4a95` — `feat(gateway): wire runAsHttp into HTTP-API entry points`

`openai-http.ts` and `openresponses-http.ts` now wrap their agent invocations in `runAsHttp("openai-chat-completions", { agentId, sessionKey, messageChannel, model })` / `runAsHttp("openresponses", …)`. Audit-log writes from tool calls inside those requests record the resolved correlation details. Both branches of openresponses (streaming + non-streaming) are wired.

### M4 instrumentation (self-edit-guard)

**Commit:** `e6807b0e98` — `feat(security): audit-log self-edit attempts (audit M4 instrumentation)`

The self-edit guard now records `self_edit.refused` / `self_edit.allowed` events in the hash-chained audit log with the target path + `toolCallId` + origin. Wired by default (gated on `ALIEN_DISABLE_AUDIT_LOG=1`). A refusal triggered by a Discord DM shows up as `{ kind: "self_edit.refused", origin: "channel:discord", target: "/opt/alien/src/sandbox/runtime-status.ts" }` so a reviewer immediately sees the source.

### M3 instrumentation (channel auto-reply)

**Commit:** `8bbb6a3617` — `feat(security): wire channel origin into reply-run + enterOrigin helper`

`runPreparedReply` (the ~600-line shared reply engine for Slack/Discord/Telegram/etc.) calls `enterChannelOrigin(provider, { sessionKey, agentId })` at function entry. Every audit-log write that fires downstream sees the originating channel.

A new helper pair `enterOrigin(origin)` / `enterChannelOrigin(kind, details)` uses `AsyncLocalStorage.enterWith()` to set the origin without forcing a callback wrap — useful for retrofitting long pre-existing handlers without big indent diffs.

---

## Phases 20–22 (instrumentation pass II)

Phases 17–19 turned the M3/M4 infrastructure into real audit-log signal for HTTP-API + channel + self-edit paths. This pass extends instrumentation to the remaining high-value events.

### M3 (operator-CLI)

**Commit:** `1fb2c4b4e1` — `feat(security): tag operator-CLI origin at runCli entry (audit M3 broader)`

`runCli` (the main CLI entry) now calls `enterOperatorOrigin({ command: argv[2] })` near the top. Foreground operator commands (`alien doctor`, `alien channels`, TUI agent runs, …) record `origin: "operator"` instead of `unknown` in the audit log. HTTP/channel paths still override their own scopes.

### M4 (sessions_send)

**Commit:** `2f58657f1f` — `feat(security): audit-log sessions_send invocations (audit M4 broader)`

The new `applySessionsSendAuditLog` wrapper records every invocation in the hash-chained audit log with the target identifier, message size in bytes (NOT content — could leak secrets), result status, and origin. `sessions_send` is the highest-blast tool that wasn't already covered: it crosses session boundaries and can fan out to subagents.

### M4 (H6 forensic loop)

**Commit:** `9e1c805d1b` — `feat(security): audit-log H6 --token rejection at gateway startup (audit M4)`

When the H6 refusal fires (someone tries `alien gateway run --token=<secret>` without `ALIEN_ALLOW_INLINE_TOKEN=1`), the gateway now writes a `gateway.token_inline_refused` event to audit.log before exiting. Records `tokenBytes` (length only — the token itself is not stored) and `argv0` for correlation across multi-install machines.

---

## Still deferred

- **M1** — per-plugin trust isolation (large redesign: capability tokens, per-plugin fs/network namespacing).
- **M4 (exec)** — wrap dangerous `exec` patterns with `appendAuditLog` like cron/self-edit/sessions_send. Same shape, more sites.
- **M2 broader migration** — gateway-token slice landed; channel tokens, OAuth credentials, and provider keys can adopt the resolver per-source.

The Lows are notes — already in good shape.
