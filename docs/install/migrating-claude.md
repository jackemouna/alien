---
summary: "Move Claude Code and Claude Desktop local state into Alien with a previewed import"
read_when:
  - You are coming from Claude Code or Claude Desktop and want to keep instructions, MCP servers, and skills
  - You need to understand what Alien imports automatically and what stays archive-only
title: "Migrating from Claude"
---

Alien imports local Claude state through the bundled Claude migration provider. The provider previews every item before changing state, redacts secrets in plans and reports, and creates a verified backup before apply.

<Note>
Onboarding imports require a fresh Alien setup. If you already have local Alien state, reset config, credentials, sessions, and the workspace first, or use `alien migrate` directly with `--overwrite` after reviewing the plan.
</Note>

## Two ways to import

<Tabs>
  <Tab title="Onboarding wizard">
    The wizard offers Claude when it detects local Claude state.

    ```bash
    alien onboard --flow import
    ```

    Or point at a specific source:

    ```bash
    alien onboard --import-from claude --import-source ~/.claude
    ```

  </Tab>
  <Tab title="CLI">
    Use `alien migrate` for scripted or repeatable runs. See [`alien migrate`](/cli/migrate) for the full reference.

    ```bash
    alien migrate claude --dry-run
    alien migrate apply claude --yes
    ```

    Add `--from <path>` to import a specific Claude Code home or project root.

  </Tab>
</Tabs>

## What gets imported

<AccordionGroup>
  <Accordion title="Instructions and memory">
    - Project `CLAUDE.md` and `.claude/CLAUDE.md` content is copied or appended into the Alien agent workspace `AGENTS.md`.
    - User `~/.claude/CLAUDE.md` content is appended into workspace `USER.md`.

  </Accordion>
  <Accordion title="MCP servers">
    MCP server definitions are imported from project `.mcp.json`, Claude Code `~/.claude.json`, and Claude Desktop `claude_desktop_config.json` when present.
  </Accordion>
  <Accordion title="Skills and commands">
    - Claude skills with a `SKILL.md` file are copied into the Alien workspace skills directory.
    - Claude command Markdown files under `.claude/commands/` or `~/.claude/commands/` are converted into Alien skills with `disable-model-invocation: true`.

  </Accordion>
</AccordionGroup>

## What stays archive-only

The provider copies these into the migration report for manual review, but does **not** load them into live Alien config:

- Claude hooks
- Claude permissions and broad tool allowlists
- Claude environment defaults
- `CLAUDE.local.md`
- `.claude/rules/`
- Claude subagents under `.claude/agents/` or `~/.claude/agents/`
- Claude Code caches, plans, and project history directories
- Claude Desktop extensions and OS-stored credentials

Alien refuses to execute hooks, trust permission allowlists, or decode opaque OAuth and Desktop credential state automatically. Move what you need by hand after reviewing the archive.

## Source selection

Without `--from`, Alien inspects the default Claude Code home at `~/.claude`, the sampled Claude Code `~/.claude.json` state file, and the Claude Desktop MCP config on macOS.

When `--from` points at a project root, Alien imports only that project's Claude files such as `CLAUDE.md`, `.claude/settings.json`, `.claude/commands/`, `.claude/skills/`, and `.mcp.json`. It does not read your global Claude home during a project-root import.

## Recommended flow

<Steps>
  <Step title="Preview the plan">
    ```bash
    alien migrate claude --dry-run
    ```

    The plan lists everything that will change, including conflicts, skipped items, and sensitive values redacted from nested MCP `env` or `headers` fields.

  </Step>
  <Step title="Apply with backup">
    ```bash
    alien migrate apply claude --yes
    ```

    Alien creates and verifies a backup before applying.

  </Step>
  <Step title="Run doctor">
    ```bash
    alien doctor
    ```

    [Doctor](/gateway/doctor) checks for config or state issues after the import.

  </Step>
  <Step title="Restart and verify">
    ```bash
    alien gateway restart
    alien status
    ```

    Confirm the gateway is healthy and your imported instructions, MCP servers, and skills are loaded.

  </Step>
</Steps>

## Conflict handling

Apply refuses to continue when the plan reports conflicts (a file or config value already exists at the target).

<Warning>
Rerun with `--overwrite` only when replacing the existing target is intentional. Providers may still write item-level backups for overwritten files in the migration report directory.
</Warning>

For a fresh Alien install, conflicts are unusual. They typically appear when you re-run the import on a setup that already has user edits.

## JSON output for automation

```bash
alien migrate claude --dry-run --json
alien migrate apply claude --json --yes
```

With `--json` and no `--yes`, apply prints the plan and does not mutate state. This is the safest mode for CI and shared scripts.

## Troubleshooting

<AccordionGroup>
  <Accordion title="Claude state lives outside ~/.claude">
    Pass `--from /actual/path` (CLI) or `--import-source /actual/path` (onboarding).
  </Accordion>
  <Accordion title="Onboarding refuses to import on an existing setup">
    Onboarding imports require a fresh setup. Either reset state and re-onboard, or use `alien migrate apply claude` directly, which supports `--overwrite` and explicit backup control.
  </Accordion>
  <Accordion title="MCP servers from Claude Desktop did not import">
    Claude Desktop reads `claude_desktop_config.json` from a platform-specific path. Point `--from` at that file's directory if Alien did not detect it automatically.
  </Accordion>
  <Accordion title="Claude commands became skills with model invocation disabled">
    By design. Claude commands are user-triggered, so Alien imports them as skills with `disable-model-invocation: true`. Edit each skill's frontmatter if you want the agent to invoke them automatically.
  </Accordion>
</AccordionGroup>

## Related

- [`alien migrate`](/cli/migrate): full CLI reference, plugin contract, and JSON shapes.
- [Migration guide](/install/migrating): all migration paths.
- [Migrating from Hermes](/install/migrating-hermes): the other cross-system import path.
- [Onboarding](/cli/onboard): wizard flow and non-interactive flags.
- [Doctor](/gateway/doctor): post-migration health check.
- [Agent workspace](/concepts/agent-workspace): where `AGENTS.md`, `USER.md`, and skills live.
