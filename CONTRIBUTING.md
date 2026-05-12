# Contributing to Alien

Welcome 👾 — thanks for considering a contribution.

Alien is a small, opinionated project early in its public life. We're happy
to take pull requests and feedback. Please read this page first so we can
keep the bar high and avoid duplicate work.

## Code of conduct

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

If your contribution is **more than a small fix**, please open an issue first
and describe what you want to do. We'd rather discuss the shape early than
re-do the review on a finished PR.

Small bug fixes and documentation tweaks: just open a PR.

## Reporting a bug

Open an issue with:

- What you tried.
- What you expected to happen.
- What actually happened (logs help — redact secrets first).
- Your environment: OS, Node version, Alien commit hash.

If you can include a minimal reproduction, we'll get to it faster.

## Proposing a feature

Open an issue tagged `proposal`. A good proposal includes:

- The user problem you're solving (not the technical solution).
- One or two example user flows.
- What you considered and rejected.
- Anything you're unsure about and want feedback on.

Don't worry about polish — rough sketches help us think along with you.

## Submitting a pull request

1. Fork `jackemouna/alien` and create a branch off `main`.
2. Make your change. Keep PRs focused — one logical change per PR.
3. Add or update tests where it makes sense. The bar:
   - New core module: unit tests for the public API.
   - Bug fix: a regression test that fails without your fix.
   - Doc/copy change: tests not required.
4. Run the local checks:
   ```bash
   pnpm tsgo:core            # core typecheck
   pnpm test src/<area>      # tests for what you touched
   ```
5. Write a clear PR description: what changed, why, what you tested.
6. Open the PR against `main`.

We aim to respond within a week. If you don't hear back, ping the PR — we may
have missed the notification.

## Coding standards

- **TypeScript, strict mode, ESM.** Avoid `any`; prefer real types, `unknown`,
  or narrow adapters.
- **Plain English in user-facing strings.** No internal jargon ("planner",
  "dispatcher", "pickup loop", "queued") in anything a user reads.
- **No semantic sentinels** like `?? 0` or empty-string defaults.
- **Tests are colocated** next to the file they test (`foo.ts` →
  `foo.test.ts`).
- **Commits** are conventional-ish: short, focused, with a clear summary line.
- **Formatting** uses [`oxfmt`](https://github.com/oxc-project/oxc), not
  Prettier. Run `pnpm format` before submitting.
- See [AGENTS.md](AGENTS.md) for the longer style guide that ships with this
  repo. It's verbose but it tells you exactly how the project thinks.

## Reviewing license terms before contributing

By submitting a contribution you agree it is licensed under the Apache
License 2.0 (see [LICENSE](LICENSE)). If your contribution touches files that
originate in upstream openclaw, please preserve the [NOTICE](NOTICE) chain.

## Security issues

**Do not** report security issues through public issues or PRs. Use the
[private disclosure path](SECURITY.md) instead.

## Where to start

Areas that always need help:

- **Bug reports from real-world use** — especially around channel inbound
  and worker output.
- **Templates.** Add a JSON file under [templates/](templates/) for a
  workflow you've actually run. The bar is "I would use this myself".
- **Docs polish.** The [docs/](docs/) tree is light on examples and screen
  recordings.
- **Channel integrations beyond Slack.** Discord, Telegram, WhatsApp,
  iMessage have channel plugins in place but project-inbox plumbing has
  only been validated end-to-end on Slack.
- **Per-plugin trust isolation (M1 hardening).** A multi-day, security-
  critical hardening item — talk to maintainers before starting.

Thanks for being here.
