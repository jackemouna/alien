# Alien Launch Plan

Public, open-source AI workforce. Apache-2.0 licensed. Incorporates
third-party MIT-licensed code with the original copyright notice
preserved in NOTICE per that license's terms. GitHub home:
`jackemouna/alien`. Dedicated landing site at the alien.\* domain (TBD)
hosts the docs + getting-started flow so non-developers can find their
way in.

## Positioning

**Tagline (working):** "Anyone can hire their own AI team. Give one prompt, your
Alien runs the business."

The product is for **anyone** — not just developers. A user spins up their own
Alien, connects their accounts (Slack, Gmail, …), and configures specialist
agents to do real work. The Alien is _theirs_ — runs on their machine or their
server, with their data and their keys. We are not a SaaS; we are the open
platform that lets anyone build their own.

### User-friendliness is a launch requirement

Every visible string in the product must be readable by a non-technical user.
No internal jargon ("planner / dispatcher / pickup loop / DAG / claim / queued").
Speak in human terms: "your team", "what should we work on?", "needs your
approval", "ready for your eyes". Empty states tell a story and offer a
"try this" example. Error messages translate technical issues to the user's
next action.

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

- Single landing `README.md` (rewrite — public-facing, plain English, the
  product pitch must fit on one screen)
- `docs/`: getting-started, install, security (threat model delta vs.
  upstream), audit-log, projects + workforce model, channel setup
  (Slack-first), plugins, configuration, troubleshooting
- Top-level: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `CHANGELOG.md`, `LICENSE` (**Apache 2.0**), `NOTICE` (preserves the
  third-party MIT copyright notice as required by that license's terms;
  the derivative is re-licensed under Apache 2.0)
- `.github/`: issue + PR templates, minimal CI workflow
- Smoke test on a clean macOS account using only `docs/getting-started.md`

### Phase G.5 — Public landing site

- Separate site repo (or `/site` subdir) hosting `alien.<domain>` landing
  page: hero, three pillars, two-minute video / GIF demo, install
  command, link to docs, GitHub link
- Plain English. No technical jargon on the marketing surface — that
  belongs in `docs/`
- Static hosting (Cloudflare Pages / GitHub Pages / Vercel — decide in
  this phase)

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
- **License: Apache 2.0** (upstream is MIT — the derivative re-licenses,
  with the upstream MIT copyright notice preserved in `NOTICE` per the MIT
  license terms)
- **Positioning: open platform for anyone**, not a personal-use tool.
  README, marketing site, and onboarding all speak to "your own AI team."
- **Plain-English UI is non-negotiable** for v0.1 launch. No internal
  jargon visible to users.
- **Dedicated public landing site** is a Phase G.5 deliverable.
