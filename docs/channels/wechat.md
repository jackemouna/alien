---
summary: "WeChat channel setup through the external alien-weixin plugin"
read_when:
  - You want to connect Alien to WeChat or Weixin
  - You are installing or troubleshooting the alien-weixin channel plugin
  - You need to understand how external channel plugins run beside the Gateway
title: "WeChat"
---

Alien connects to WeChat through Tencent's external
`@tencent-weixin/alien-weixin` channel plugin.

Status: external plugin. Direct chats and media are supported. Group chats are not
advertised by the current plugin capability metadata.

## Naming

- **WeChat** is the user-facing name in these docs.
- **Weixin** is the name used by Tencent's package and by the plugin id.
- `alien-weixin` is the Alien channel id.
- `@tencent-weixin/alien-weixin` is the npm package.

Use `alien-weixin` in CLI commands and config paths.

## How it works

The WeChat code does not live in the Alien core repo. Alien provides the
generic channel plugin contract, and the external plugin provides the
WeChat-specific runtime:

1. `alien plugins install` installs `@tencent-weixin/alien-weixin`.
2. The Gateway discovers the plugin manifest and loads the plugin entrypoint.
3. The plugin registers channel id `alien-weixin`.
4. `alien channels login --channel alien-weixin` starts QR login.
5. The plugin stores account credentials under the Alien state directory.
6. When the Gateway starts, the plugin starts its Weixin monitor for each
   configured account.
7. Inbound WeChat messages are normalized through the channel contract, routed to
   the selected Alien agent, and sent back through the plugin outbound path.

That separation matters: Alien core should stay channel-agnostic. WeChat login,
Tencent iLink API calls, media upload/download, context tokens, and account
monitoring are owned by the external plugin.

## Install

Quick install:

```bash
npx -y @tencent-weixin/alien-weixin-cli install
```

Manual install:

```bash
alien plugins install "@tencent-weixin/alien-weixin"
alien config set plugins.entries.alien-weixin.enabled true
```

Restart the Gateway after install:

```bash
alien gateway restart
```

## Login

Run QR login on the same machine that runs the Gateway:

```bash
alien channels login --channel alien-weixin
```

Scan the QR code with WeChat on your phone and confirm the login. The plugin saves
the account token locally after a successful scan.

To add another WeChat account, run the same login command again. For multiple
accounts, isolate direct-message sessions by account, channel, and sender:

```bash
alien config set session.dmScope per-account-channel-peer
```

## Access control

Direct messages use the normal Alien pairing and allowlist model for channel
plugins.

Approve new senders:

```bash
alien pairing list alien-weixin
alien pairing approve alien-weixin <CODE>
```

For the full access-control model, see [Pairing](/channels/pairing).

## Compatibility

The plugin checks the host Alien version at startup.

| Plugin line | Alien version        | npm tag  |
| ----------- | ----------------------- | -------- |
| `2.x`       | `>=2026.3.22`           | `latest` |
| `1.x`       | `>=2026.1.0 <2026.3.22` | `legacy` |

If the plugin reports that your Alien version is too old, either update
Alien or install the legacy plugin line:

```bash
alien plugins install @tencent-weixin/alien-weixin@legacy
```

## Sidecar process

The WeChat plugin can run helper work beside the Gateway while it monitors the
Tencent iLink API. In issue #68451, that helper path exposed a bug in Alien's
generic stale-Gateway cleanup: a child process could try to clean up the parent
Gateway process, causing restart loops under process managers such as systemd.

Current Alien startup cleanup excludes the current process and its ancestors,
so a channel helper must not kill the Gateway that launched it. This fix is
generic; it is not a WeChat-specific path in core.

## Troubleshooting

Check install and status:

```bash
alien plugins list
alien channels status --probe
alien --version
```

If the channel shows as installed but does not connect, confirm that the plugin is
enabled and restart:

```bash
alien config set plugins.entries.alien-weixin.enabled true
alien gateway restart
```

If the Gateway restarts repeatedly after enabling WeChat, update both Alien and
the plugin:

```bash
npm view @tencent-weixin/alien-weixin version
alien plugins install "@tencent-weixin/alien-weixin" --force
alien gateway restart
```

If startup reports that the installed plugin package `requires compiled runtime
output for TypeScript entry`, the npm package was published without the compiled
JavaScript runtime files Alien needs. Update/reinstall after the plugin
publisher ships a fixed package, or temporarily disable/uninstall the plugin.

Temporary disable:

```bash
alien config set plugins.entries.alien-weixin.enabled false
alien gateway restart
```

## Related docs

- Channel overview: [Chat Channels](/channels)
- Pairing: [Pairing](/channels/pairing)
- Channel routing: [Channel Routing](/channels/channel-routing)
- Plugin architecture: [Plugin Architecture](/plugins/architecture)
- Channel plugin SDK: [Channel Plugin SDK](/plugins/sdk-channel-plugins)
- External package: [@tencent-weixin/alien-weixin](https://www.npmjs.com/package/@tencent-weixin/alien-weixin)
