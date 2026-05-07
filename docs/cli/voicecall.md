---
summary: "CLI reference for `alien voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall setup|smoke|call|continue|dtmf|status|tail|expose`
title: "Voicecall"
---

# `alien voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

When the Gateway is running, operational commands (`call`, `start`,
`continue`, `speak`, `dtmf`, `end`, and `status`) are sent to that Gateway's
voice-call runtime. If no Gateway is reachable, they fall back to a standalone
CLI runtime.

Primary doc:

- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
alien voicecall setup
alien voicecall smoke
alien voicecall status --json
alien voicecall status --call-id <id>
alien voicecall call --to "+15555550123" --message "Hello" --mode notify
alien voicecall continue --call-id <id> --message "Any questions?"
alien voicecall dtmf --call-id <id> --digits "ww123456#"
alien voicecall end --call-id <id>
```

`setup` prints human-readable readiness checks by default. Use `--json` for
scripts:

```bash
alien voicecall setup --json
```

`status` prints active calls as JSON by default. Pass `--call-id <id>` to inspect
one call.

For external providers (`twilio`, `telnyx`, `plivo`), setup must resolve a public
webhook URL from `publicUrl`, a tunnel, or Tailscale exposure. A loopback/private
serve fallback is rejected because carriers cannot reach it.

`smoke` runs the same readiness checks. It will not place a real phone call
unless both `--to` and `--yes` are present:

```bash
alien voicecall smoke --to "+15555550123"        # dry run
alien voicecall smoke --to "+15555550123" --yes  # live notify call
```

## Exposing webhooks (Tailscale)

```bash
alien voicecall expose --mode serve
alien voicecall expose --mode funnel
alien voicecall expose --mode off
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.

## Related

- [CLI reference](/cli)
- [Voice call plugin](/plugins/voice-call)
