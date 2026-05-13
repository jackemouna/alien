# Alien 👾

**Anyone can hire their own AI team. Give one prompt, your Alien runs the business.**

Alien is an open-source AI workforce you run on your own machine. You set a goal,
your team of AI workers breaks it into tasks, picks them up one by one, and
delivers — all on a visual board you can watch and steer in real time. No
shared cloud. No middleman. Your keys, your data, your Alien.

```
👤 You: "Draft a polite reply to every non-urgent email from today, and flag the urgent ones."

👾 Planner: Splits this into 3 tasks → 1 researcher (scan inbox), 2 email-handler (flag + draft)

🤖 Your team:
   ┌─ Needs your OK ─┐ ┌─ Up next ─┐ ┌─ Working on it ─┐ ┌─ For your review ─┐ ┌─ Done ─┐
   │                  │ │           │ │ scan-inbox       │ │                    │ │       │
   └──────────────────┘ └───────────┘ └──────────────────┘ └────────────────────┘ └───────┘
```

A few seconds later, three drafts are waiting in Gmail for your approval, and
you know exactly which emails are urgent.

---

## Why Alien

Most AI tools are either chat boxes (you do all the work) or black-box SaaS
agents (someone else's cloud, someone else's keys). Alien is different:

- **You hire a team, not a single assistant.** A planner breaks goals into
  tasks. Specialists (researcher, writer, editor, publisher, email-handler)
  pick them up. You watch the board.
- **It lives on your machine.** Your API keys, your accounts, your files,
  your audit log. The gateway runs in-process; nothing routes through a
  third-party agent platform.
- **Hardened by default.** Tamper-evident audit log of every action, OS
  keychain for secrets, sandbox-by-default for shell-touching tools, narrow
  OAuth scopes per integration.
- **Reachable from the channels you already use.** DM Alien on Slack and
  it creates tasks on the right project; the worker replies in the same
  thread when it's done. (Discord, Telegram, WhatsApp, iMessage, and others
  inherit the same hook.)
- **Open source under Apache 2.0.** A derivative of MIT-licensed
  [openclaw](https://github.com/openclaw/openclaw) — see [NOTICE](NOTICE).

## How it works

```
┌────────────────────┐    ┌───────────────────────────────────┐    ┌────────────────────┐
│  Your prompt       │ →  │  Planner agent breaks it into     │ →  │  Visual Kanban     │
│  (UI / Slack DM /  │    │  ~3–6 tasks with dependencies     │    │  board on your     │
│  CLI)              │    │  and priorities                   │    │  gateway           │
└────────────────────┘    └───────────────┬───────────────────┘    └─────────┬──────────┘
                                          │                                  │
                                          ▼                                  ▼
                          ┌───────────────────────────┐         ┌──────────────────────┐
                          │ Auto-pickup loop claims   │         │ You approve, retry,  │
                          │ each task, runs the right │  ←───→  │ pause, or watch      │
                          │ specialist worker         │         │                      │
                          └───────────────────────────┘         └──────────────────────┘
                                          │
                                          ▼
                          ┌───────────────────────────┐
                          │ Worker output replies in  │
                          │ the same channel the task │
                          │ came from (Slack thread,  │
                          │ email draft, file on disk)│
                          └───────────────────────────┘
```

Every state transition is signed into a tamper-evident audit log so you can
always answer "who did what, and on whose behalf?"

## Try it in two minutes

```bash
# 1. Clone and install
git clone https://github.com/jackemouna/alien.git ~/Developer/alien
cd ~/Developer/alien
pnpm install

# 2. Drop your Anthropic key
export ANTHROPIC_API_KEY=sk-ant-…   # or run `alien init` and it tells you what to do

# 3. Check setup
pnpm alien init

# 4. Start the gateway
pnpm alien gateway start

# 5. Open the control UI in your browser, click Projects → Use this template
#    (5 starter templates ship out of the box)
```

For the full happy-path walkthrough see [docs/getting-started.md](docs/getting-started.md).

## Starter templates

Five copy-paste starting points ship with Alien — your team starts working
the moment you click one:

| Template                 | What it does                                                  |
| ------------------------ | ------------------------------------------------------------- |
| 📥 **Sort my inbox**     | Flags urgent email, drafts replies for the rest (needs Gmail) |
| 📰 **Morning brief**     | Researches your topics, emails a one-page summary             |
| 📝 **Weekly newsletter** | Drafts a polished newsletter every Monday                     |
| 🤝 **Meeting prep**      | One-pager about the person and company you're meeting         |
| ✨ **Social drafts**     | Week of post drafts for X + LinkedIn                          |

Add your own as JSON files under [templates/](templates/).

## What's in the box

| Surface                      | What it gives you                                             |
| ---------------------------- | ------------------------------------------------------------- |
| **Projects board**           | Persistent workspaces with a live Kanban view                 |
| **Quick briefs**             | One-shot research jobs without a full project                 |
| **Planner agent**            | Free-form prompt → typed task DAG (Claude Sonnet 4.6)         |
| **Auto-pickup loop**         | Workers claim tasks race-safely, every 2.5s                   |
| **Gmail integration**        | Read inbox, draft replies, send mail (your own OAuth client)  |
| **Slack channel inbox**      | DM the bot, get tasks on the right project, replies in-thread |
| **Tamper-evident audit log** | Hash-chained JSONL of every tool call                         |
| **OS keychain for secrets**  | macOS Keychain / Linux libsecret, opt-in                      |
| **`alien gmail connect`**    | One-command OAuth wizard for Gmail                            |
| **`alien init`**             | Friendly setup-status check with next-step guidance           |

## Status

This is an early public release. Tier 2 v0.1 — workforce model + Slack channel

- Gmail integration. See [LAUNCH-PLAN.md](LAUNCH-PLAN.md) for what's next.

## Docs

- [Getting started](docs/getting-started.md) — the 10-minute happy path
- [Install](docs/install.md) — full install options
- [Projects + workforce model](docs/projects.md) — how the team works
- [Configuration reference](docs/configuration.md) — every env var + config key
- [Audit log](docs/audit-log.md) — what's logged, how to verify
- [Troubleshooting](docs/troubleshooting.md) — common errors and fixes
- [Security policy](SECURITY.md) — how to report a vulnerability
- [Contributing](CONTRIBUTING.md) — submit code, file issues, propose features

## License

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Alien is a derivative of [openclaw](https://github.com/openclaw/openclaw)
(MIT). The upstream copyright notice is preserved in [NOTICE](NOTICE) as
required by the MIT license terms.
