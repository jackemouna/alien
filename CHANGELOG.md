# Changelog

All notable user-facing changes to Alien land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog starts at v0.1.0, the first public release of Alien.

## Unreleased

### Added

- **Projects + workforce model** — persistent workspaces with a visual
  Kanban board, an auto-pickup worker loop, a planner agent that turns
  free-form prompts into typed task DAGs, and a tamper-evident audit log
  entry for every state transition.
- **Quick briefs (orchestrator)** — one-shot research jobs producing a
  short markdown brief from a list of topics. Lives at `/v1/orchestrator/runs`
  and the "Quick briefs" tab.
- **Slack-as-inbox plumbing** — Slack DMs into a project-bound channel
  become Tasks on that project; worker output replies in the same thread.
  Other channels (Discord/Telegram/WhatsApp/iMessage/etc.) inherit the same
  hook via the new `channel-inbound` listener.
- **Gmail integration** — `alien gmail connect <email>` walks an OAuth
  flow, persists tokens to the OS keychain, and the `email-handler` worker
  can read inbox, draft replies, and send mail.
- **`alien init` setup-status check** — friendly seven-point status with a
  plain-English next-step suggestion.
- **Starter templates gallery** — five copy-paste-able workflows
  (📥 Sort my inbox, 📰 Morning brief, 📝 Weekly newsletter, 🤝 Meeting prep,
  ✨ Social drafts) shipped as JSON under `templates/`.
- **Apache 2.0 license**. Upstream MIT copyright preserved in `NOTICE`.

### Changed

- Public-facing UI text rewritten in plain English everywhere. Kanban
  columns now read "Needs your OK / Up next / Working on it / For your
  review / Done / Stuck / Didn't work" instead of the internal status
  enum. Error messages translate gateway protocol errors into actionable
  user advice.
- `ANTHROPIC_API_KEY` may now be resolved from the OS keychain
  (`ALIEN_SECRETS_FROM_KEYCHAIN=1`, service `alien.ai`, account
  `anthropic-api-key`) in addition to the env var.

### Security

- New hash-chained audit-log namespace `projects.task.*` for every Project
  state transition (created, queued, claimed, completed, failed, blocked).
- Channel-inbox listener is observation-only and never intercepts the
  auto-reply path.
- Gmail OAuth scopes deliberately narrow: `gmail.readonly`, `gmail.send`,
  `gmail.compose`. Alien never requests `mail.google.com` or
  `gmail.modify`.

### Notes

- Pre-1.0 we may make breaking changes between minor releases. Once we
  cross 1.0 we'll follow strict SemVer.
