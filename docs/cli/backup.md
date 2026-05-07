---
summary: "CLI reference for `alien backup` (create local backup archives)"
read_when:
  - You want a first-class backup archive for local Alien state
  - You want to preview which paths would be included before reset or uninstall
title: "Backup"
---

# `alien backup`

Create a local backup archive for Alien state, config, auth profiles, channel/provider credentials, sessions, and optionally workspaces.

```bash
alien backup create
alien backup create --output ~/Backups
alien backup create --dry-run --json
alien backup create --verify
alien backup create --no-include-workspace
alien backup create --only-config
alien backup verify ./2026-03-09T00-00-00.000Z-alien-backup.tar.gz
```

## Notes

- The archive includes a `manifest.json` file with the resolved source paths and archive layout.
- Default output is a timestamped `.tar.gz` archive in the current working directory.
- If the current working directory is inside a backed-up source tree, Alien falls back to your home directory for the default archive location.
- Existing archive files are never overwritten.
- Output paths inside the source state/workspace trees are rejected to avoid self-inclusion.
- `alien backup verify <archive>` validates that the archive contains exactly one root manifest, rejects traversal-style archive paths, and checks that every manifest-declared payload exists in the tarball.
- `alien backup create --verify` runs that validation immediately after writing the archive.
- `alien backup create --only-config` backs up just the active JSON config file.

## What gets backed up

`alien backup create` plans backup sources from your local Alien install:

- The state directory returned by Alien's local state resolver, usually `~/.alien`
- The active config file path
- The resolved `credentials/` directory when it exists outside the state directory
- Workspace directories discovered from the current config, unless you pass `--no-include-workspace`

Model auth profiles are already part of the state directory under
`agents/<agentId>/agent/auth-profiles.json`, so they are normally covered by the
state backup entry.

If you use `--only-config`, Alien skips state, credentials-directory, and workspace discovery and archives only the active config file path.

Alien canonicalizes paths before building the archive. If config, the
credentials directory, or a workspace already live inside the state directory,
they are not duplicated as separate top-level backup sources. Missing paths are
skipped.

The archive payload stores file contents from those source trees, and the embedded `manifest.json` records the resolved absolute source paths plus the archive layout used for each asset.

Installed plugin source and manifest files under the state directory's
`extensions/` tree are included, but their nested `node_modules/` dependency
trees are skipped. Those dependencies are rebuildable install artifacts; after
restoring an archive, use `alien plugins update <id>` or reinstall the plugin
with `alien plugins install <spec> --force` when a restored plugin reports
missing dependencies.

## Invalid config behavior

`alien backup` intentionally bypasses the normal config preflight so it can still help during recovery. Because workspace discovery depends on a valid config, `alien backup create` now fails fast when the config file exists but is invalid and workspace backup is still enabled.

If you still want a partial backup in that situation, rerun:

```bash
alien backup create --no-include-workspace
```

That keeps state, config, and the external credentials directory in scope while
skipping workspace discovery entirely.

If you only need a copy of the config file itself, `--only-config` also works when the config is malformed because it does not rely on parsing the config for workspace discovery.

## Size and performance

Alien does not enforce a built-in maximum backup size or per-file size limit.

Practical limits come from the local machine and destination filesystem:

- Available space for the temporary archive write plus the final archive
- Time to walk large workspace trees and compress them into a `.tar.gz`
- Time to rescan the archive if you use `alien backup create --verify` or run `alien backup verify`
- Filesystem behavior at the destination path. Alien prefers a no-overwrite hard-link publish step and falls back to exclusive copy when hard links are unsupported

Large workspaces are usually the main driver of archive size. If you want a smaller or faster backup, use `--no-include-workspace`.

For the smallest archive, use `--only-config`.

## Related

- [CLI reference](/cli)
