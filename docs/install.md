# Install

Two ways to get Alien running today: **clone + pnpm** (recommended for v0.1)
or **build from source**. A one-line installer is on the roadmap; the v0.1
install path is a `git clone`.

## Requirements

- **Node 22 or newer**. `nvm install 22` if you're on an older Node.
- **pnpm 9 or newer**. `npm install -g pnpm` if you don't have it.
- **macOS 13+** or **a modern Linux distro**. Tested on macOS 15 (Sequoia)
  and Ubuntu 24.04.
- About **2 GB of free disk** (Node deps + the bundled control-UI build).

## Clone and install

```bash
git clone https://github.com/jackemouna/alien.git ~/Developer/alien
cd ~/Developer/alien
pnpm install
```

Then follow the [Getting started](getting-started.md) walkthrough to get to
a working first run in 10 minutes.

## Update

```bash
cd ~/Developer/alien
git pull --rebase
pnpm install
pnpm build
```

If `git pull` reports merge conflicts in a file you've personally edited
(your own templates, custom workers, etc.), resolve them by hand. Alien
stores your state at `~/.alien/`, not in the repo, so updating the repo
won't touch your projects, tokens, or audit log.

## Recommended environment variables

```bash
# Plain-text API key (skip if you use the keychain path below)
export ANTHROPIC_API_KEY=sk-ant-…

# Opt into OS-keychain secret storage (preferred for production use)
export ALIEN_SECRETS_FROM_KEYCHAIN=1

# Sandbox-by-default profile (recommended for any deployment beyond local play)
export ALIEN_HARDENED_DEFAULTS=1

# Optional: Gmail integration
export GMAIL_OAUTH_CLIENT_ID=…
export GMAIL_OAUTH_CLIENT_SECRET=…
export GMAIL_DEFAULT_ACCOUNT=you@example.com
```

Put these in `~/.zshrc` or `~/.bashrc` so the gateway picks them up on
every start.

## Anthropic credentials

You need an Anthropic API key for the planner agent and most worker roles
to function. Get one at
[console.anthropic.com/keys](https://console.anthropic.com/keys).

Two storage paths, in order of preference:

### Option A: OS keychain (recommended)

```bash
# macOS:
security add-generic-password \
  -s "alien.ai" \
  -a "anthropic-api-key" \
  -w "sk-ant-…"

# Linux (libsecret):
secret-tool store \
  --label "Alien Anthropic key" \
  service alien.ai account anthropic-api-key

# Then opt in:
export ALIEN_SECRETS_FROM_KEYCHAIN=1
```

Restart the gateway. `pnpm alien init` should now show
"Anthropic API key configured".

### Option B: Plain env var

```bash
export ANTHROPIC_API_KEY=sk-ant-…
```

Easier for first run, fine for local exploration, but **don't ship this
in `.env` files or CI configs** for a production install — anything that
reads the file gets your key.

## Gmail credentials

The Gmail integration uses the standard Google OAuth flow. Alien
deliberately does **not** ship Google credentials — your install has its
own OAuth app, branded as you, with you in control of the consent screen
and the scopes.

### Create a Google Cloud OAuth client

1. Go to
   [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   and select (or create) a project.
2. Enable the **Gmail API** under "APIs & Services → Library".
3. Click **Create credentials → OAuth client ID**.
4. Choose **Web application** as the application type.
5. Add **`http://localhost:8086/oauth2callback`** as an authorized
   redirect URI.
6. Save. You'll get a **client ID** and a **client secret**.

### Tell Alien about the credentials

Two paths, same shape as for Anthropic:

**Env vars:**

```bash
export GMAIL_OAUTH_CLIENT_ID=<client-id>
export GMAIL_OAUTH_CLIENT_SECRET=<client-secret>
```

**Keychain (preferred):**

```bash
# macOS:
security add-generic-password -s "alien.ai" -a "gmail-oauth-client-id" -w "<id>"
security add-generic-password -s "alien.ai" -a "gmail-oauth-client-secret" -w "<secret>"
export ALIEN_SECRETS_FROM_KEYCHAIN=1
```

### Authorize an inbox

```bash
pnpm alien gmail connect you@example.com
```

The CLI prints a Google sign-in URL, opens a localhost server on port 8086
to receive the callback, exchanges the code for tokens, and persists them
to your keychain.

Then tell the gateway which inbox the email-handler should use by default:

```bash
export GMAIL_DEFAULT_ACCOUNT=you@example.com
```

(Tasks can also override this per-call by including `"account":
"someone@else.com"` in the task input.)

## Hardened defaults

`ALIEN_HARDENED_DEFAULTS=1` enables the sandbox-by-default profile for
shell-touching tools. This is the recommended setting for any deployment
beyond local exploration on your own laptop. The trade-off: tools that
need to touch your filesystem outside the workspace need explicit
approval.

Set it in your shell init and restart the gateway:

```bash
export ALIEN_HARDENED_DEFAULTS=1
```

`pnpm alien init` confirms it's on.

## Directory layout

After first run, Alien stores everything under `~/.alien/`:

```
~/.alien/
  alien.json            — gateway config (auth mode, mode=local, etc.)
  audit.log             — hash-chained append-only log of every action
  projects/             — Project + Task state, one directory per project
  orchestrator/         — Quick-brief run state
  canvas/               — Canvas host state
  identity/             — pairing identities
  plugins/              — installed plugin metadata
  logs/                 — config-audit log + diagnostics
```

The state directory is created with `0o700` permissions (you only). Task
and project files are `0o600`. Tokens never live as plaintext files; they
go through the OS keychain.

## Uninstall

```bash
# Remove the code:
rm -rf ~/Developer/alien

# Remove your state (irreversible — destroys projects, audit log, etc.):
rm -rf ~/.alien

# Remove keychain entries:
security delete-generic-password -s "alien.ai" -a "anthropic-api-key"
security delete-generic-password -s "alien.ai" -a "gmail-oauth-client-id"
security delete-generic-password -s "alien.ai" -a "gmail-oauth-client-secret"
pnpm alien gmail disconnect you@example.com  # (before deleting the code)
```

## Docker / Linux server install

Not yet supported out of the box. The codebase runs on Linux, but
production-grade hosting requires a systemd unit, a TLS-terminating
reverse proxy, and careful key/token storage that the v0.1 docs don't
walk through yet. See [LAUNCH-PLAN.md](../LAUNCH-PLAN.md) for the v0.2
roadmap.
