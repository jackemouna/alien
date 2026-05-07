---
summary: "Uninstall Alien completely (CLI, service, state, workspace)"
read_when:
  - You want to remove Alien from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

Two paths:

- **Easy path** if `alien` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
alien uninstall
```

Non-interactive (automation / npx):

```bash
alien uninstall --all --yes --non-interactive
npx -y alien uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
alien gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
alien gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${ALIEN_STATE_DIR:-$HOME/.alien}"
```

If you set `ALIEN_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.alien/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g alien
pnpm remove -g alien
bun remove -g alien
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/Alien.app
```

Notes:

- If you used profiles (`--profile` / `ALIEN_PROFILE`), repeat step 3 for each state dir (defaults are `~/.alien-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `alien` is missing.

### macOS (launchd)

Default label is `ai.alien.gateway` (or `ai.alien.<profile>`; legacy `com.alien.*` may still exist):

```bash
launchctl bootout gui/$UID/ai.alien.gateway
rm -f ~/Library/LaunchAgents/ai.alien.gateway.plist
```

If you used a profile, replace the label and plist name with `ai.alien.<profile>`. Remove any legacy `com.alien.*` plists if present.

### Linux (systemd user unit)

Default unit name is `alien-gateway.service` (or `alien-gateway-<profile>.service`):

```bash
systemctl --user disable --now alien-gateway.service
rm -f ~/.config/systemd/user/alien-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `Alien Gateway` (or `Alien Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "Alien Gateway"
Remove-Item -Force "$env:USERPROFILE\.alien\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.alien-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://alien.ai/install.sh` or `install.ps1`, the CLI was installed with `npm install -g alien@latest`.
Remove it with `npm rm -g alien` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `alien ...` / `bun run alien ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.

## Related

- [Install overview](/install)
- [Migration guide](/install/migrating)
