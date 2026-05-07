---
summary: "Quick examples for installing, listing, uninstalling, updating, and publishing Alien plugins"
read_when:
  - You want quick plugin install, list, update, or uninstall examples
  - You want to choose between ClawHub and npm plugin distribution
  - You are publishing a plugin package
title: "Manage plugins"
sidebarTitle: "Manage plugins"
---

Most plugin workflows are a few commands: search, install, restart the Gateway,
verify, and uninstall when you no longer need the plugin.

## List plugins

```bash
alien plugins list
alien plugins list --enabled
alien plugins list --verbose
alien plugins list --json
```

Use `--json` for scripts. It includes registry diagnostics and each plugin's
static `dependencyStatus` when the plugin package declares `dependencies` or
`optionalDependencies`.

```bash
alien plugins list --json \
  | jq '.plugins[] | {id, enabled, format, source, dependencyStatus}'
```

`plugins list` is a cold inventory check. It shows what Alien can discover
from config, manifests, and the plugin registry; it does not prove that an
already-running Gateway process imported the plugin runtime.

## Install plugins

```bash
# Search ClawHub for plugin packages.
alien plugins search "calendar"

# Bare package specs try ClawHub first, then npm fallback.
alien plugins install <package>

# Force one source.
alien plugins install clawhub:<package>
alien plugins install npm:<package>

# Install a specific version or dist-tag.
alien plugins install clawhub:<package>@1.2.3
alien plugins install clawhub:<package>@beta
alien plugins install npm:@scope/alien-plugin@1.2.3
alien plugins install npm:@alien/codex

# Install from git or a local development checkout.
alien plugins install git:github.com/acme/alien-plugin@v1.0.0
alien plugins install ./my-plugin
alien plugins install --link ./my-plugin
```

After installing plugin code, restart the Gateway that serves your channels:

```bash
alien gateway restart
alien plugins inspect <plugin-id> --runtime --json
```

Use `inspect --runtime` when you need proof that the plugin registered runtime
surfaces such as tools, hooks, services, Gateway methods, or plugin-owned CLI
commands.

## Update plugins

```bash
alien plugins update <plugin-id>
alien plugins update <npm-package-or-spec>
alien plugins update --all
```

If a plugin was installed from an npm dist-tag such as `@beta`, later
`update <plugin-id>` calls reuse that recorded tag. Passing an explicit npm spec
switches the tracked install to that spec for future updates.

```bash
alien plugins update @scope/alien-plugin@beta
alien plugins update @scope/alien-plugin
```

The second command moves a plugin back to the registry's default release line
when it was previously pinned to an exact version or tag.

When `alien update` runs on the beta channel, default-line npm and ClawHub
plugin records try the matching plugin `@beta` release first. If that beta
release does not exist, Alien falls back to the recorded default/latest spec.
For npm plugins, Alien also falls back when the beta package exists but fails
install validation. Exact versions and explicit tags such as `@rc` or `@beta`
are preserved.

## Uninstall plugins

```bash
alien plugins uninstall <plugin-id> --dry-run
alien plugins uninstall <plugin-id>
alien plugins uninstall <plugin-id> --keep-files
alien gateway restart
```

Uninstall removes the plugin's config entry, plugin index record, allow/deny list
entries, and linked load paths when applicable. Managed install directories are
removed unless you pass `--keep-files`.

In Nix mode (`ALIEN_NIX_MODE=1`), plugin install, update, uninstall, enable,
and disable commands are disabled. Manage those choices in the Nix source for
the install instead; for nix-alien, use the agent-first
[Quick Start](https://github.com/alien/nix-alien#quick-start).

## Publish plugins

You can publish external plugins to [ClawHub](https://clawhub.ai), npmjs.com, or
both.

### Publish to ClawHub

ClawHub is the primary public discovery surface for Alien plugins. It gives
users searchable metadata, version history, and registry scan results before
install.

```bash
npm i -g clawhub
clawhub login
clawhub package publish your-org/your-plugin --dry-run
clawhub package publish your-org/your-plugin
clawhub package publish your-org/your-plugin@v1.0.0
```

Users install from ClawHub with:

```bash
alien plugins install clawhub:<package>
alien plugins install <package>
```

The bare form still checks ClawHub first.

### Publish to npmjs.com

Native npm plugins must include a plugin manifest and `package.json` Alien
entrypoint metadata.

```json package.json
{
  "name": "@acme/alien-plugin",
  "version": "1.0.0",
  "type": "module",
  "alien": {
    "extensions": ["./dist/index.js"]
  }
}
```

```bash
npm publish --access public
```

Users install npm-only with:

```bash
alien plugins install npm:@acme/alien-plugin
alien plugins install npm:@acme/alien-plugin@beta
alien plugins install npm:@acme/alien-plugin@1.0.0
```

If the same package is also available on ClawHub, `npm:` skips ClawHub lookup and
forces npm resolution.

## Source choice

- **ClawHub**: use when you want Alien-native discovery, scan summaries,
  versions, and install hints.
- **npmjs.com**: use when you already ship JavaScript packages or need npm
  dist-tags/private registry workflows.
- **Git**: use when you want to install directly from a branch, tag, or commit.
- **Local path**: use when you are developing or testing a plugin on the same
  machine.

## Related

- [Plugins](/tools/plugin) - overview and troubleshooting
- [`alien plugins`](/cli/plugins) - full CLI reference
- [ClawHub](/tools/clawhub) - publish and registry operations
- [Building plugins](/plugins/building-plugins) - create a plugin package
- [Plugin manifest](/plugins/manifest) - manifest and package metadata
