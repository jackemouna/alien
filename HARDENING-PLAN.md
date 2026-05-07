# Alien — Hardening Implementation Plan

Phased execution of the High findings in [AUDIT.md](AUDIT.md). One phase = one commit (or one tightly-scoped group). Each phase is self-contained: targeted tests pass, the build is green, the next phase doesn't depend on this one's design choices.

Already landed:

- ✅ **H7** — hono override bumped to ≥4.12.16 (`794c371408`)
- ✅ **H6** — gateway `--token` CLI flag rejected unless `ALIEN_ALLOW_INLINE_TOKEN=1` (`bb3a0ed95a`)

---

## Phase 1 — H2: self-modification guard

**Goal:** the `fs_write` and `edit` tools refuse writes that target files inside Alien's own source tree (the repo root, anything under `src/`, `extensions/`, `packages/`, `scripts/`, `apps/`, `ui/`, `docs/`, plus `package.json`, `pnpm-lock.yaml`, `tsconfig*`, etc.) unless `ALIEN_ALLOW_SELF_EDIT=1` is set. Without this guard, one prompt-injected `write` call can flip the sandbox flag, drop tools from the deny list, or rewrite startup code, undoing every other defense.

**Approach:** add a single check inside the tool entry point that resolves the absolute target path, compares it against the resolved path of the running CLI's repo root (derived from `process.argv[1]` via `alien.mjs`'s install location), and refuses if the target sits inside that tree. Mirror the existing `nodes-workspace-guard` pattern at [src/agents/alien-tools.nodes-workspace-guard.ts](src/agents/alien-tools.nodes-workspace-guard.ts) — that one already does an inside-repo check for the `nodes` tool, so we reuse the same shape.

**Files to touch:**

- `src/agents/pi-tools.host-edit.ts` (or wherever `write`/`edit` ultimately resolve paths)
- New: `src/security/self-edit-guard.ts` — small helper that returns `{ allowed: true } | { allowed: false; reason: string }`
- Tests in the new helper + an integration test in the tool path

**Tests:**

- writes to `/tmp/foo.txt` → allowed
- writes to `<repo>/src/agents/sandbox/runtime-status.ts` → refused, mentions `ALIEN_ALLOW_SELF_EDIT`
- writes to `<repo>/package.json` → refused
- writes when `ALIEN_ALLOW_SELF_EDIT=1` → allowed
- a workspace path inside `<repo>/.alien-workspace/` (or wherever the agent's working dir lives) → still allowed

**Commit:** `feat(security): refuse fs_write/edit into Alien's own source tree (audit H2)`

---

## Phase 2 — H5: pairing wrong-code rate limit

**Goal:** stop the silent brute-force of pairing codes. Per-sender exponential backoff after 3 wrong submissions; refuse new attempts within the cooldown window; log a warning the operator sees on the next `alien doctor` run when wrong-code rate exceeds N/hour.

**Approach:** extend the existing pairing store at [src/pairing/pairing-store.ts](src/pairing/pairing-store.ts). Add a `wrongAttempts: { count, firstAt, lastAt }` block to the per-sender record (already keyed by sender ID). On wrong-code, increment counter; on right code, reset. Read counter at the top of `approveChannelPairingCode` and short-circuit with a "rate limited" result if cooldown active. Cooldown formula: `cooldownMs = base * 2^max(0, count - 3)` capped at e.g. 30 min.

**Files to touch:**

- `src/pairing/pairing-store.ts` — add fields, increment/reset logic, cooldown check
- The pairing-store tests (alongside the file)

**Tests:**

- 3 wrong codes from one sender → 3 explicit rejections, no cooldown yet
- 4th wrong code → "rate limited" rejection that doesn't even check the code
- right code after 1 wrong code → reset counter, accept
- a sender whose cooldown has passed → can attempt again
- cooldown is per-sender (sender A does not affect sender B)

**Commit:** `feat(pairing): per-sender wrong-code backoff + lockout (audit H5)`

---

## Phase 3 — H4: untrusted-input fencing on inbound DMs

**Decision baked in:** **option 2** from the earlier check-in — caller-driven `untrusted` parameter on `buildAgentMessageFromConversationEntries`. We trace the channel-driven call sites and pass `untrusted: true` there; operator-driven paths keep the existing un-fenced format. Slightly more code archaeology than option 1, but doesn't burn tokens on every operator message.

**Goal:** when entries originate from a channel (DM/group), wrap each entry's body in a structural fence with a per-prompt randomized marker so the model can distinguish "message text" from "operator instructions". No security warning prepended (we use the lighter structural fence, not `wrapExternalContent`'s heavy treatment, to keep token budget reasonable). The existing `wrapExternalContent` is what the _high-stakes_ sources (web fetch, PDF) already use; DMs are fenced more lightly because they're contextual chat history.

**Approach:**

1. Add an optional second parameter `{ untrusted?: boolean }` to `buildAgentMessageFromConversationEntries`.
2. When `untrusted` is true, wrap each entry body with `<msg_body id="<rand-8-hex>">…</msg_body>` markers. Replace any literal `</msg_body` in the body with a sanitized form before insertion.
3. Trace call sites; flip `untrusted: true` only on the channel/auto-reply path.

**Files to touch:**

- `src/gateway/agent-prompt.ts` — function signature + fencing
- `src/gateway/agent-prompt.test.ts` — adapt existing tests, add fenced-output tests
- The 1–3 call sites that will pass `untrusted: true` (identified during execution)

**Tests:**

- existing operator-path tests pass unchanged
- new test: channel-path wraps each body in unique-ID markers
- new test: literal `</msg_body` appearing in a body is sanitized
- new test: marker IDs differ between calls (uniqueness)

**Commit:** `feat(gateway): structural fencing for inbound channel messages (audit H4)`

---

## Phase 4 — H3: confirmation gates on high-blast tools

**Decision baked in:** start with `fs_delete` and `cron` (always require approval by default, configurable to off via `tools.fs_delete.ask = false` / `tools.cron.ask = false`), and **leave `fs_write`/`sessions_send`/`gateway` opt-IN** (require operator to set `tools.<name>.ask = true` to enable approval). Reasoning: `fs_delete` and `cron` are catastrophic-by-default (data loss, persistent execution); `fs_write` is too common to gate by default without crippling the agent; `sessions_send`/`gateway` need session-aware policy that's a larger redesign.

**Goal:** generalize the existing exec-approval pipeline at [src/gateway/exec-approval-manager.ts](src/gateway/exec-approval-manager.ts) and [src/infra/exec-approvals.ts](src/infra/exec-approvals.ts) to dispatch on tool name rather than being exec-only. Plumb the same approval flow through for `fs_delete` and `cron`.

**Approach:**

1. Identify the existing exec-approval entry point (the function the `exec` tool calls before executing).
2. Refactor it to a generic `approveToolCall({ tool, params })` that returns `approved | denied | pending → wait`.
3. Wire `fs_delete` and `cron` tool implementations to call it.
4. Add config keys `tools.fs_delete.ask` (default true) and `tools.cron.ask` (default true).
5. Document.

**Files to touch:** `src/gateway/exec-approval-manager.ts`, `src/infra/exec-approvals.ts`, `src/agents/pi-tools.host-edit.ts` (or wherever fs_delete lives), the cron tool, config schema, tests.

**Tests:**

- `fs_delete` with default config → approval required
- `fs_delete` with `tools.fs_delete.ask = false` → executes immediately
- `cron` with default config → approval required
- approval timeout behavior
- existing exec-approval tests still pass

**Commit:** `feat(security): approval gates for fs_delete and cron tools (audit H3)`

---

## Phase 5 — H1: sandbox-off warning at startup

**Decision baked in:** **don't flip the default**, surface a startup warning instead. Reasoning: flipping `agents.defaults.sandbox.mode` from `"off"` to `"docker"` requires Docker Desktop running on every operator's machine, breaks first-run setup, and is the single biggest UX shift in this audit. A loud startup warning + a one-line config knob (`agents.defaults.sandbox.mode: "docker"`) gets most of the benefit without the breakage. Flipping the default can be a follow-up once the operator opts in.

**Goal:** at gateway startup, if `agents.defaults.sandbox.mode === "off"` (or unset, which resolves to `"off"`), and the main session has at least one of `exec`/`fs_write`/`fs_delete`/`browser` enabled, print a one-paragraph warning to the gateway log with a link to the hardening guide. Add a new `ALIEN_HARDENED_DEFAULTS=1` env var that, if set, flips the default to `"docker"` for the run. `alien doctor` should also surface the warning.

**Files to touch:**

- `src/agents/sandbox/runtime-status.ts` — read the env var; flip default when set
- Wherever the gateway emits startup banner — add the warning conditional
- `src/cli/doctor*` — surface the same warning
- Tests

**Tests:**

- mode `"off"` + dangerous tools → warning emitted at startup
- mode `"docker"` → no warning
- `ALIEN_HARDENED_DEFAULTS=1` + no explicit mode → effective mode is `"docker"`
- `ALIEN_HARDENED_DEFAULTS=1` + explicit `mode: "off"` in config → operator's config wins (warning still fires)

**Commit:** `feat(security): startup warning when main-session sandbox is off (audit H1)`

---

## Phase 6 — README-HARDENING.md

Final commit: a user-facing summary of every behavior change in this fork vs. upstream openclaw. One section per phase. Each section says: what changed, what env var/config flips it back, what threat it addresses, and the audit reference (H1–H7).

**Commit:** `docs: README-HARDENING.md describes fork's security deltas vs upstream`

---

## Verification at the end

- `pnpm test` (whole suite) — green
- `pnpm build` — green
- Spot-check `alien --version`, `alien doctor` — runs cleanly
- Push branch to `marczellklein/alien` (or wherever the user lands the fork)

---

## Things explicitly NOT in this plan

- Re-flipping `sandbox.mode` default to `docker` (deferred per Phase 5 decision)
- Per-plugin trust isolation (M1 in audit — much larger redesign)
- Keychain integration for secrets (M2 — invasive, OS-specific)
- Full tamper-evident audit log (M4 — needs operator UX)
- Untrusted-input fencing on operator paths (only channel paths get fenced in Phase 3)
- Renaming `@openclaw/fs-safe` (it's an upstream dep)
