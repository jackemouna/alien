# Troubleshooting

The errors that come up most often during first-run setup, and the
exact fix for each. If your issue isn't here, file it at
[github.com/jackemouna/alien/issues](https://github.com/jackemouna/alien/issues).

Before anything else, run `pnpm alien init`. It checks the seven
most-common setup issues and tells you which one is wrong.

## Setup

### "Missing config. Run `alien setup` or set gateway.mode=local"

The gateway hasn't been told this is a local install yet.

```bash
pnpm alien config set gateway.mode local
```

This is a one-time setting. Don't pass `--allow-unconfigured` on each
start — that flag bypasses the check but doesn't fix the underlying
config.

### "Gateway start blocked: existing config is missing gateway.mode"

Same fix as above. The `alien config set` command rewrites
`~/.alien/alien.json` with the right shape.

### "Anthropic API key not set"

Either:

```bash
export ANTHROPIC_API_KEY=sk-ant-…
```

…or store it in the OS keychain (the more secure path):

```bash
# macOS:
security add-generic-password -s "alien.ai" -a "anthropic-api-key" -w "sk-ant-…"

# Linux:
secret-tool store --label "Alien Anthropic key" \
  service alien.ai account anthropic-api-key

# Then opt in:
export ALIEN_SECRETS_FROM_KEYCHAIN=1
```

Restart the gateway after setting either. `pnpm alien init` confirms
the key is reachable.

### "State directory ~/.alien (permissions 755)" — wrong mode

Alien expects the state directory to be readable only by you (mode
`0o700`). Fix it:

```bash
chmod 700 ~/.alien
```

If a previous tool created the directory with looser permissions, this
catches it.

### "OS keychain unavailable"

- **macOS** — the keychain CLI lives at `/usr/bin/security`. If it's
  missing you're on a stripped-down macOS install; Alien will fall
  back to env-var secrets.
- **Linux** — install `libsecret-tools` (Ubuntu/Debian) or `libsecret`
  (Fedora/Arch). Once `secret-tool --help` runs cleanly, restart the
  gateway.

## Runtime

### "Gmail isn't connected yet" when you ran `alien gmail connect`

The gateway started **before** your shell exported
`GMAIL_DEFAULT_ACCOUNT`. The worker reads the env var at boot, so
restart the gateway after exporting it:

```bash
export GMAIL_DEFAULT_ACCOUNT=you@example.com
# Stop the gateway (Ctrl-C if foreground) and start again.
pnpm alien gateway run
```

### Project sits at "Up next" forever

The auto-pickup loop only starts after the first request to
`/v1/projects`. Opening the Projects tab in the UI triggers it. If
you're hitting the API via curl, hit `/v1/projects` once first.

This is a known limitation of the v0.1 boot wiring — eager-start at
gateway boot is on the roadmap.

### "no LLM available — set ANTHROPIC_API_KEY…"

Same as "Anthropic API key not set" above. The gateway sees the key
once at boot; restart it after setting the key.

### Tasks fail immediately with "createAnthropicLlmClient: ANTHROPIC_API_KEY is required"

Your key is set in **your** shell but the gateway was started from a
different shell (or a launchd plist, or a tmux session) that doesn't
see it. Either:

- Set the env var in your shell init (`~/.zshrc` / `~/.bashrc`) so
  every new shell inherits it, **or**
- Use the OS keychain path so the value lives independently of your
  shell environment.

### "Couldn't find your Google OAuth credentials" when running `alien gmail connect`

You haven't set up the Google Cloud OAuth client yet. Follow
[Install → Gmail credentials](install.md#gmail-credentials) — it
walks through the Cloud Console steps.

Alien deliberately doesn't ship Google credentials so your install has
its own consent screen branded as you.

## UI / browser

### Control UI shows "Connecting…" forever

Three usual causes:

1. **Wrong port.** Default is `127.0.0.1:18091`. If you set
   `ALIEN_GATEWAY_PORT` differently, point the browser at that.
2. **Auth token mismatch.** If you persisted a token with
   `alien config set gateway.auth.token`, paste exactly that token in
   the UI prompt.
3. **The gateway exited.** Check the terminal you started it from —
   the last few log lines usually explain why.

### Templates gallery is empty

Run `pnpm alien init`. If it says "Starter templates not found", the
`templates/` directory in the repo got removed or you're running from
a non-repo location. Pull `main` again.

### Kanban columns don't move

Check the gateway logs for `[project-router]` or `[pickup-loop]`
warnings. The most common cause is a worker error — click the task to
see its error message. If the worker's output mentions a missing
secret (Anthropic key, Gmail tokens), the fix is in **Setup** above.

## CLI

### `pnpm alien <command>` exits with "command not found"

Either:

- You're in the wrong directory. The CLI must run from the repo root
  (`~/Developer/alien`) for `pnpm alien` to resolve.
- `pnpm install` hasn't completed. Run it once and retry.

### `alien config set` says "Updated <key>. Restart the gateway to apply"

That's expected — config changes don't hot-reload. Stop the gateway
(Ctrl-C) and start it again.

## Build / dev

### `pnpm build` fails on a specific file

If the build was working and just broke:

1. `pnpm install` once (deps may have shifted).
2. `git status` to confirm no half-applied patches.
3. `pnpm tsgo:core` for a faster typecheck signal than the full build.

If you're on a fresh clone, the install may have been incomplete.
`rm -rf node_modules && pnpm install` is the nuclear option.

### Tests pass locally but the issue persists

Tests cover code correctness, not feature correctness. For UI changes,
you have to actually click around in a browser to verify. For
integration changes, run the real flow (`alien gmail connect`,
`alien gateway run`, etc.) end-to-end. The smoke-test pattern is in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Audit log

### `audit.log` is huge

Every state transition adds an entry. For an active install with
multiple projects this can grow into the tens of MB. Pruning is
deliberately manual — see [audit-log.md](audit-log.md#size-management).

### `alien security audit-log` says the chain is broken

Either a file was hand-edited or a write was interrupted. The chain
break is _expected_ to be detectable — that's the whole point of the
hash chain. See [audit-log.md](audit-log.md#what-to-do-when-the-chain-breaks).

## Reporting an issue

If your issue isn't here:

1. Run `pnpm alien init` and include the output in the issue.
2. Capture the relevant gateway logs (`/tmp/alien/alien-*.log`),
   **redact any secrets**, and attach them.
3. Note your OS, Node version, and the commit you're on
   (`git rev-parse HEAD`).
4. File at [github.com/jackemouna/alien/issues](https://github.com/jackemouna/alien/issues).
