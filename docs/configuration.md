# Configuration reference

Every `ALIEN_*` environment variable and the most-used keys in
`~/.alien/alien.json`, in one searchable page.

Run `pnpm alien init` for a friendly status check of the most-common
ones. This page is for when you want the full inventory.

## Where settings live

Alien reads settings from three places, in this priority order:

1. **Environment variables** — set in your shell init or by the
   service manager that starts the gateway.
2. **`~/.alien/alien.json`** — written by `alien config set` and
   the onboarding flow. Persistent across restarts.
3. **OS keychain** — when `ALIEN_SECRETS_FROM_KEYCHAIN=1`, secret
   lookups (Anthropic key, Gmail credentials, gateway token) fall
   back to the keychain when an env var is empty.

Env vars always win. Keychain lookups only happen if both env and
config are missing.

## Recommended starter env

Drop this in your shell init:

```bash
# Security posture
export ALIEN_HARDENED_DEFAULTS=1
export ALIEN_SECRETS_FROM_KEYCHAIN=1

# Anthropic (optional if stored in keychain)
export ANTHROPIC_API_KEY=sk-ant-…

# Gmail (only if connecting Gmail)
export GMAIL_OAUTH_CLIENT_ID=…
export GMAIL_OAUTH_CLIENT_SECRET=…
export GMAIL_DEFAULT_ACCOUNT=you@example.com
```

## Environment variables

### Core

| Var                           | Purpose                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`           | Anthropic API key for the planner + all LLM-backed workers. Falls back to keychain `service=alien.ai, account=anthropic-api-key` when `ALIEN_SECRETS_FROM_KEYCHAIN=1`. |
| `ALIEN_HARDENED_DEFAULTS`     | `1` → enables sandbox-by-default for tools with shell access. Recommended for any deployment beyond local play.                                                        |
| `ALIEN_SECRETS_FROM_KEYCHAIN` | `1` → secret lookups (Anthropic, Gmail, gateway token) fall back to the OS keychain when env is empty.                                                                 |
| `ALIEN_STATE_DIR`             | Override `~/.alien`. Use absolute paths only.                                                                                                                          |
| `ALIEN_DISABLE_AUDIT_LOG`     | `1` → skip writing to `~/.alien/audit.log`. Only useful for tests; never set in production.                                                                            |

### Gateway

| Var                               | Purpose                                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALIEN_GATEWAY_HOST`              | Bind host. Default `127.0.0.1`.                                                                                                                 |
| `ALIEN_GATEWAY_PORT`              | Bind port. Default `18091`.                                                                                                                     |
| `ALIEN_ALLOW_INSECURE_PRIVATE_WS` | `1` → allow plaintext WebSocket on private-network IPs. **Loopback is always allowed.** Default off; turn on only for Tailscale/LAN dev setups. |

### Gmail integration

| Var                         | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `GMAIL_OAUTH_CLIENT_ID`     | Your Google Cloud OAuth client ID.                                           |
| `GMAIL_OAUTH_CLIENT_SECRET` | Your Google Cloud OAuth client secret.                                       |
| `GMAIL_OAUTH_REDIRECT_URI`  | Override the default `http://localhost:8086/oauth2callback`.                 |
| `GMAIL_DEFAULT_ACCOUNT`     | Default email address the worker uses when a task doesn't specify `account`. |

### Local-dev / tests

| Var                        | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `ALIEN_LOCAL_CHECK`        | `1` → run heavier validation locally instead of deferring to CI.           |
| `ALIEN_LOCAL_CHECK_MODE`   | `throttled` (default) or `full`. Controls how aggressive local checks are. |
| `ALIEN_VITEST_MAX_WORKERS` | Pin test parallelism. `1` for serial; default chooses based on CPU.        |
| `ALIEN_LIVE_TEST`          | `1` → enable live network-dependent tests (paired with `pnpm test:live`).  |

## `alien.json` keys

Set with `pnpm alien config set <key> <value>`. Get with
`pnpm alien config get <key>`. The full schema lives at
[src/config/schema.base.ts](../src/config/schema.base.ts); this section
covers the most-used keys.

### gateway

| Key                           | What it does                                                                                                                                                    | Example              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `gateway.mode`                | `"local"` for self-hosted single-user. Required for the gateway to start (or pass `--allow-unconfigured`).                                                      | `local`              |
| `gateway.auth.mode`           | `"token"` (shared-secret bearer), `"password"` (the same as token but with a different label), or unset (the gateway auto-generates a runtime token per start). | `token`              |
| `gateway.auth.token`          | The bearer token clients must send. Min entropy enforced; the gateway refuses to start with placeholder values.                                                 | (long random string) |
| `gateway.trustedProxies`      | Array of IPs/CIDRs whose `X-Forwarded-For` header the gateway trusts. Default empty.                                                                            | `["10.0.0.0/8"]`     |
| `gateway.allowRealIpFallback` | `true` → trust `X-Real-IP` from trusted proxies. Default `false`.                                                                                               | `true`               |

### agents

| Key                                    | What it does                                                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents.defaults.sandbox.mode`         | `"off"` (full host access — the upstream default), `"non-main"` (sandbox non-main sessions), `"all"` (sandbox everywhere). `ALIEN_HARDENED_DEFAULTS=1` forces `"all"` at runtime. |
| `agents.defaults.sandbox.backend`      | `"docker"` (default — needs Docker Desktop), `"local"`, or others your plugins register.                                                                                          |
| `agents.defaults.heartbeat.intervalMs` | How often the heartbeat tick fires per agent. Default ~60s.                                                                                                                       |

### channels

Per-channel config lives at `channels.<id>.accounts[<accountId>].<field>`.
Examples:

| Key                                             | Example   |
| ----------------------------------------------- | --------- |
| `channels.slack.accounts.default.botToken`      | `xoxb-…`  |
| `channels.slack.accounts.default.appToken`      | `xapp-…`  |
| `channels.slack.accounts.default.signingSecret` | `…`       |
| `channels.discord.accounts.default.token`       | bot token |
| `channels.telegram.accounts.default.botToken`   | bot token |

Each channel plugin documents its own keys; the full list is at
[docs/channels/](channels/) (inherited from upstream — some paths still
reference `github.com/alien/alien`; v0.1 fork docs will catch up).

### models.providers

Provider-specific model config and tool-routing rules. The full schema
is generated; see `pnpm alien config:docs:gen` if you want a local copy.

## Keychain entries

When `ALIEN_SECRETS_FROM_KEYCHAIN=1`, Alien looks up these entries
when the corresponding env var is empty:

| Service          | Account                     | What it holds                                               |
| ---------------- | --------------------------- | ----------------------------------------------------------- |
| `alien.ai`       | `anthropic-api-key`         | Anthropic API key                                           |
| `alien.ai`       | `gmail-oauth-client-id`     | Google Cloud OAuth client ID                                |
| `alien.ai`       | `gmail-oauth-client-secret` | Google Cloud OAuth client secret                            |
| `alien.ai/gmail` | `<email-address>`           | Per-account Gmail tokens (managed by `alien gmail connect`) |
| `alien.ai`       | `gateway-token`             | Gateway bearer token (when `gateway.auth.mode=token`)       |

Inspect with:

```bash
# macOS:
security find-generic-password -s "alien.ai" -a "anthropic-api-key" -w

# Linux:
secret-tool lookup service alien.ai account anthropic-api-key
```

Delete with the same command shape, replacing `find-generic-password`
with `delete-generic-password` (macOS) or `lookup` with `clear`
(Linux).

## File layout

```
~/.alien/
  alien.json              — main config (mode 0o600)
  alien.json.bak          — automatic backup from the last `alien config set`
  alien.json.last-good    — last config that passed startup validation
  audit.log               — hash-chained event log (mode 0o600)
  logs/
    config-audit.jsonl    — every config write, with sha256 before/after
  projects/<id>/
    project.json          — Project metadata
    tasks/<id>.json       — one file per Task
    .tasks.lock           — claim lock managed by the pickup loop
  orchestrator/runs/<id>.json — Quick-brief run state
  canvas/                 — Canvas host state
  identity/               — pairing identities
  plugins/                — installed plugin metadata
```

All files are mode `0o600`, all directories `0o700`. If permissions
loosen for any reason, `pnpm alien init` flags them and tells you how
to fix.

## Resetting to defaults

```bash
# Stop the gateway, then:
mv ~/.alien/alien.json ~/.alien/alien.json.preserved
pnpm alien config set gateway.mode local
```

You'll get a fresh `alien.json` with just `gateway.mode=local` set.
Your projects, audit log, and keychain entries are untouched.
