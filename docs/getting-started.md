# Getting started

The 10-minute happy path: clone Alien, give it a key, click a starter
template, watch a real piece of work happen.

> If anything along the way breaks, run `pnpm alien init` — it tells you in
> plain English what's missing and how to fix it.

## Before you start

You'll need:

- **Node 22 or newer** and **pnpm 9 or newer**. `node -v` should print
  something like `v22.11.0`.
- **An Anthropic API key**. Get one at
  [console.anthropic.com/keys](https://console.anthropic.com/keys).
- **macOS or Linux**. Windows support is best-effort right now.
- About **10 minutes**.

## 1. Clone and install

```bash
git clone https://github.com/jackemouna/alien.git ~/Developer/alien
cd ~/Developer/alien
pnpm install
```

The install takes a minute or two on first run. It pulls Node deps and
builds the control UI bundle.

## 2. Drop your API key

The simplest path is an environment variable in your shell init:

```bash
export ANTHROPIC_API_KEY=sk-ant-…
```

If you'd rather keep secrets out of plaintext env, store the key in your OS
keychain instead:

```bash
# macOS (uses Keychain):
security add-generic-password -s "alien.ai" -a "anthropic-api-key" -w "sk-ant-…"

# Then opt in at runtime:
export ALIEN_SECRETS_FROM_KEYCHAIN=1
```

Linux users with `libsecret` installed can use `secret-tool` — Alien reads
from the same standard libsecret schema.

## 3. Check setup

```bash
pnpm alien init
```

You should see something like:

```
👾 Alien setup check

Here's how your install looks right now:
  ✓  Anthropic API key configured
  ✓  State directory ~/.alien (permissions 700)
  ✓  OS keychain available (macos-security)
  ·  Hardened defaults not enabled
        Set ALIEN_HARDENED_DEFAULTS=1 to enable the sandbox-by-default profile.
  ·  Gmail not configured (optional)
        Skip if you don't need email.
  ✓  5 starter templates loaded

What's next:
  → Set ALIEN_HARDENED_DEFAULTS=1 …
```

The first time you run this on a fresh machine you may see "State directory
will be created on first gateway start" — that's expected.

## 4. Tell the gateway it's a local install (one-time)

```bash
pnpm alien config set gateway.mode local
```

This sets the gateway profile so it knows you're running it on your own
machine, not behind a multi-tenant proxy. You only need to do this once.

## 5. Start the gateway

```bash
pnpm alien gateway run
```

The gateway boots in about a second and prints:

```
[gateway] http server listening (0 plugins, 0.7s)
[gateway] ready
```

Leave it running. The default control-UI address is `http://127.0.0.1:18091`.

> The first boot generates a runtime auth token if you haven't persisted
> one. For convenience while exploring, persist a known token:
> `pnpm alien config set gateway.auth.mode token && \
 pnpm alien config set gateway.auth.token <your-token>`

## 6. Open the control UI

Open `http://127.0.0.1:18091` in your browser. When prompted, paste your
gateway token.

You'll see the navigation: **Chat**, **Projects** (your new workforce
board), **Quick briefs** (the orchestrator), and **Settings**.

## 7. Click a starter template

In the **Projects** tab you'll see a welcome card and a gallery of five
starter templates:

- 📥 **Sort my inbox** (needs Gmail)
- 📰 **Morning brief**
- 📝 **Weekly newsletter**
- 🤝 **Meeting prep**
- ✨ **Social drafts**

Click **"Use this template"** on **Morning brief** (it's the simplest — no
external integrations required). The new-project modal opens pre-filled
with a sensible name and goal. Click **"Start project"**.

A few seconds later the Kanban columns start moving: a researcher claims
the first task, then a writer, then an editor, then a publisher writes the
final brief to disk.

> If a task gets stuck for more than 30 seconds, click it to see the worker
> output and any error message.

## 8. Watch the work happen

The board polls every 3 seconds, so you'll see cards move from **Up next**
→ **Working on it** → **Done** in real time. Click any task to see its
output. Click **"Looks good — go"** on tasks that need your approval (the
planner marks high-impact actions, like sending emails, as needing OK).

## 9. Try your own prompt

In the project detail view, scroll up to the **"What should your team work
on?"** box. Type a real request:

> _Draft a polite reply email to the next meeting I have. Tell them I need
> to push by one day, suggest Thursday morning instead._

Click **"Send to the team"**. Watch the planner break it into tasks. When
each task finishes, look at the output — for an email task, you'll get a
Gmail draft in your inbox waiting for your approval.

## 10. (Optional) Connect Gmail

If you want the email-handler worker to read your inbox and draft replies:

```bash
pnpm alien gmail connect you@example.com
```

The CLI walks you through the OAuth dance: it builds a Google sign-in URL,
opens it in your browser, and waits for the callback. After you grant
access the tokens are stored in your OS keychain.

You'll also need to set up the Google side once — see
[docs/install.md#gmail-credentials](install.md#gmail-credentials).

## What now

- Browse the [Projects + workforce model](projects.md) doc to understand
  how the team makes decisions.
- Read [SECURITY.md](../SECURITY.md) to see what Alien guarantees and what
  it doesn't.
- Check [LAUNCH-PLAN.md](../LAUNCH-PLAN.md) for what's next on the roadmap.
- File issues at https://github.com/jackemouna/alien/issues.

## Troubleshooting

**Gateway exits with "Missing config. Run `alien setup` …"**
Run `pnpm alien config set gateway.mode local` once.

**`pnpm alien init` says "no LLM available"**
`ANTHROPIC_API_KEY` isn't reaching the gateway. Either set it in the shell
you start the gateway from, or store it in the OS keychain with
`ALIEN_SECRETS_FROM_KEYCHAIN=1`.

**Templates gallery is empty**
The `templates/` directory in the repo got removed or moved. Pull `main`
again, or pass `--templates-dir /path/to/templates` (planned for v0.2).

**Project sits at "Up next" forever**
The auto-pickup loop only starts after the first request to `/v1/projects`.
Opening the Projects tab in the UI triggers it. If you're hitting routes
via curl, hit `/v1/projects` once first.

**"Gmail isn't connected yet" when you ran `alien gmail connect`**
The gateway started before your shell exported `GMAIL_DEFAULT_ACCOUNT`.
Restart the gateway after setting it.
