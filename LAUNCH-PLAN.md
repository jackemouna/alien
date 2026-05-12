# Alien Launch Plan

Personal fork of openclaw, rebranded as Alien 👾. Public-ready, easy-to-use,
demonstrably better than openclaw. Final GitHub home: `jackemouna/alien`.

## Positioning

**Tagline (working):** "Give one prompt. A team of agents runs your business."

**Four pillars** — v0.1 must ship a credible demo of each:

1. Channels-in, channels-out. User DMs Alien from Slack/Discord/Telegram/etc.
   Inbound = create task; outbound = reply in the same thread.
2. Projects + Tasks + visual Kanban board. Persistent workspace per goal.
3. Auto-pickup loop. Workers pull queued tasks every tick; humans watch.
4. Delegator (planner) agent. Free-form prompt → task DAG. Workers do the rest.

Security hardening (H1-H7, M2-M8) is the trust foundation, not the headline.

## Scope tier — locked at Tier 2

- 1 channel: **Slack**
- 3 integrations: planner + worker chain only for v0.1 (Gmail follows in v0.2)
- Auto-pickup default: pull-by-default with per-project approval flag
- Mac app: deferred from v0.1

Tier 3 (everything) is a v0.2 target.

## Phases

### Phase A — Foundation audit ✓ done

Soul / heartbeat / cron / Slack / file-lock / audit-log all intact and
extensible. Slack is fully wired for DM-in + thread-reply-out.

### Phase B — Projects + Tasks + auto-pickup ✓ done

Commit `db…` (Phase B). New `src/projects/` module: types, state-machine,
disk store (0o700 / 0o600), race-safe claim over `withFileLock`, audit hooks,
interval pickup loop with M3 origin propagation, planner with strict-JSON
validation. 48 tests, all green.

### Phase C — Visual Kanban board UI (~2 sessions)

- Gateway HTTP routes: GET/POST/PATCH `/v1/projects/...`
- Lit view `ui/src/ui/views/projects.ts`: project list + Kanban columns
  (backlog / queued / in-progress / review / done / blocked / failed)
- New "Projects" tab + nav wiring
- Polls every 2.5s; matches the orchestrator tab pattern

### Phase D — Slack-as-inbox (~1 session)

- Project ↔ Slack channel binding (config + UI affordance)
- Inbound DM in a bound channel → planner → tasks on the project
- Worker completion → reply in originating thread via existing
  `sendMessageSlack(to, msg, {threadTs})`
- Audit entries already carry `channel:slack` origin

### Phase E — Gmail integration (~2 sessions)

- New `extensions/gmail/` extension
- OAuth via `provider-auth-runtime` (clone `extensions/google/` shape)
- Tokens in OS keychain via `provider-secret-runtime`
- Tools: `gmail.read_inbox`, `gmail.send`, `gmail.draft_reply`
- Optionally also: a new `email-handler` worker role for the planner

### Phase F — Onboarding wizard + templates (~2 sessions)

- `alien init` interactive flow: API key → first project → first channel
  pairing → first prompt
- Defaults: `ALIEN_HARDENED_DEFAULTS=1` + `ALIEN_SECRETS_FROM_KEYCHAIN=1`
  unless explicitly disabled
- Templates gallery: 5 starter prompts shipped under `templates/`

### Phase G — Docs + repo + smoke (~2 sessions)

- Single landing `README.md` (rewrite — public-facing)
- `docs/`: getting-started, install, security (threat model delta vs.
  upstream), audit-log, orchestrator, plugins, configuration, troubleshooting
- Top-level: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `CHANGELOG.md`, `LICENSE` (MIT, preserved from upstream), `NOTICE`
  (credits openclaw)
- `.github/`: issue + PR templates, minimal CI workflow
- Smoke test on a clean macOS account using only `docs/getting-started.md`

### Phase H — Launch

- Push to `jackemouna/alien` (still private)
- Soft launch: 3–5 trusted reviewers
- Flip public, tag `v0.1.0`, pin a welcome Discussion

## Deferred to v0.2+

- Mac app (blocked on Xcode license accept)
- Per-plugin trust isolation (M1 hardening — multi-day work)
- More integrations: Calendar, Notion, GHL, Meta Graph, X, LinkedIn
- Cron integration for orchestrator runs
- Per-workflow config files
- Re-planning mid-run (planner revises DAG on failure)

## Definition of "polished" before launch

- Every UI surface has an empty-state with a clear CTA
- Every error message includes the next action the user should take
- `alien doctor` is clean on a fresh `~/.alien` dir
- The README's install command works cold on a clean machine
- A non-author can follow `docs/getting-started.md` and produce a brief
  in under 10 minutes
- The 2 remaining M-tier security items are either closed or explicitly
  documented as deferred with threat-model delta

## Decisions logged

- Tier 2 v0.1 — workforce + Slack + Gmail
- Auto-pickup pull-by-default, per-project approval flag
- Channel for v0.1: Slack
- Workforce loop runs in-process inside the gateway (not a separate daemon)
- Planner uses Claude Sonnet 4.6 — Opus 4.7 upgrade is a v0.2 consideration
- License stays MIT, NOTICE credits upstream openclaw
