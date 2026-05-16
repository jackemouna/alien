import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logWarn } from "../logger.js";
import { setKeychainSecret } from "../security/os-keychain.js";
import { readJsonBodyOrError, sendInvalidRequest, sendJson } from "./http-common.js";

/**
 * Step-by-step "Add a channel" wizard, served as standalone HTML pages.
 * Reachable from the first-run /setup flow (Step 2) and from the main UI's
 * Channels tab via a prominent "+ Add a channel" button.
 *
 * v0.1 supports three channels with full step-by-step UX:
 *
 *   - Telegram  — easiest (@BotFather, 30 seconds)
 *   - Discord   — second easiest (developer portal, ~90 seconds)
 *   - Slack     — most steps (manifest install + bot + app token)
 *
 * Other channels (WhatsApp / Matrix / Signal / Mattermost / Teams / etc.)
 * show "Coming in v0.2" placeholders. They still work via the JSON config
 * editor in the main UI, but the guided path lands later.
 *
 * Persistence: validated tokens go to the OS keychain
 * (`service=alien.ai`, `account=<channel>-token` or sub-keys), and a flag
 * file at `${state-dir}/channels.json` tracks which channels are enabled.
 * The next gateway boot picks these up. Live hot-reload is a v0.2 polish.
 *
 * Routes:
 *   GET  /setup/channels                          — picker page
 *   GET  /setup/channels/telegram                 — Telegram wizard
 *   GET  /setup/channels/discord                  — Discord wizard
 *   GET  /setup/channels/slack                    — Slack wizard
 *   POST /v1/setup/channels/validate-telegram     — { botToken } -> { ok, name, username }
 *   POST /v1/setup/channels/validate-discord      — { token }    -> { ok, name, id }
 *   POST /v1/setup/channels/validate-slack        — { botToken, appToken } -> { ok, team, user }
 *   POST /v1/setup/channels/save                  — { channel, credentials } -> { ok }
 *   POST /v1/setup/channels/status                — { configured: [...] }
 */

type ChannelId = "telegram" | "discord" | "slack" | "whatsapp" | "imessage";

const WIZARD_PATHS = new Set([
  "/setup/channels",
  "/setup/channels/telegram",
  "/setup/channels/discord",
  "/setup/channels/slack",
  "/setup/channels/whatsapp",
  "/setup/channels/imessage",
  "/v1/setup/channels/validate-telegram",
  "/v1/setup/channels/validate-discord",
  "/v1/setup/channels/validate-slack",
  "/v1/setup/channels/imessage-permission",
  "/v1/setup/channels/save",
  "/v1/setup/channels/status",
]);

export function isChannelsWizardPath(pathname: string): boolean {
  return WIZARD_PATHS.has(pathname);
}

export async function handleChannelsWizardRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isChannelsWizardPath(pathname)) return false;

  if (!isLoopbackRequest(req)) {
    sendJson(res, 403, {
      error: { type: "forbidden", message: "Channels wizard is loopback-only" },
    });
    return true;
  }

  if (pathname.startsWith("/setup/channels")) {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return true;
    }
    const html =
      pathname === "/setup/channels"
        ? renderPickerHtml()
        : pathname === "/setup/channels/telegram"
          ? renderTelegramWizardHtml()
          : pathname === "/setup/channels/discord"
            ? renderDiscordWizardHtml()
            : pathname === "/setup/channels/slack"
              ? renderSlackWizardHtml()
              : pathname === "/setup/channels/whatsapp"
                ? renderWhatsAppWizardHtml()
                : pathname === "/setup/channels/imessage"
                  ? renderIMessageWizardHtml()
                  : null;
    if (!html) {
      res.statusCode = 404;
      res.end();
      return true;
    }
    sendHtml(res, 200, html);
    return true;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return true;
  }

  if (pathname === "/v1/setup/channels/status") {
    sendJson(res, 200, await readChannelsStatus());
    return true;
  }

  const body = (await readJsonBodyOrError(req, res, 8192)) as
    | {
        readonly botToken?: unknown;
        readonly token?: unknown;
        readonly appToken?: unknown;
        readonly channel?: unknown;
        readonly credentials?: unknown;
      }
    | undefined;
  if (body === undefined) return true;

  if (pathname === "/v1/setup/channels/validate-telegram") {
    const botToken = readStr(body.botToken);
    if (!botToken) return badRequest(res, "Missing botToken");
    sendJson(res, 200, await validateTelegram(botToken));
    return true;
  }

  if (pathname === "/v1/setup/channels/validate-discord") {
    const token = readStr(body.token);
    if (!token) return badRequest(res, "Missing token");
    sendJson(res, 200, await validateDiscord(token));
    return true;
  }

  if (pathname === "/v1/setup/channels/validate-slack") {
    const botToken = readStr(body.botToken);
    const appToken = readStr(body.appToken);
    if (!botToken || !appToken) return badRequest(res, "Missing botToken or appToken");
    sendJson(res, 200, await validateSlack(botToken, appToken));
    return true;
  }

  if (pathname === "/v1/setup/channels/imessage-permission") {
    sendJson(res, 200, await checkIMessagePermission());
    return true;
  }

  if (pathname === "/v1/setup/channels/save") {
    const channel = readStr(body.channel);
    if (
      channel !== "telegram" &&
      channel !== "discord" &&
      channel !== "slack" &&
      channel !== "whatsapp" &&
      channel !== "imessage"
    ) {
      return badRequest(
        res,
        "channel must be one of: telegram, discord, slack, whatsapp, imessage",
      );
    }
    const credentials =
      body.credentials && typeof body.credentials === "object"
        ? (body.credentials as Record<string, unknown>)
        : {};
    const result = await saveChannel(channel as ChannelId, credentials);
    sendJson(res, result.ok ? 200 : 500, result);
    return true;
  }

  return false;
}

async function checkIMessagePermission(): Promise<{
  readonly platform: NodeJS.Platform;
  readonly hasFullDiskAccess: boolean;
  readonly chatDbPath: string;
}> {
  const home = process.env.HOME ?? "/Users/unknown";
  const chatDbPath = path.join(home, "Library/Messages/chat.db");
  if (process.platform !== "darwin") {
    return { platform: process.platform, hasFullDiskAccess: false, chatDbPath };
  }
  try {
    // Reading the DB file requires Full Disk Access on macOS — a small read
    // is enough to probe permission without locking the file.
    const fh = await fs.open(chatDbPath, "r");
    const buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
    await fh.close();
    return { platform: "darwin", hasFullDiskAccess: true, chatDbPath };
  } catch {
    return { platform: "darwin", hasFullDiskAccess: false, chatDbPath };
  }
}

// ------ validation ------

type ValidationOk = Record<string, unknown> & { readonly ok: true };
type ValidationFail = { readonly ok: false; readonly error: string };

async function validateTelegram(botToken: string): Promise<ValidationOk | ValidationFail> {
  // Loose sanity check only: catch the most common paste mistake
  // (forgot the colon entirely). Anything else goes through to
  // Telegram so they can give an authoritative verdict — bot tokens
  // can include characters our regex might not anticipate, and a
  // false-reject is worse than a round trip.
  const trimmed = botToken.trim();
  if (!trimmed.includes(":")) {
    return {
      ok: false,
      error:
        "Telegram bot tokens contain a colon between the bot id and the key — like 123456789:AAH... Looks like you pasted only part of it. Copy the whole token from @BotFather and try again.",
    };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${trimmed}/getMe`);
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: { id?: number; username?: string; first_name?: string };
      description?: string;
    } | null;
    if (res.ok && data?.ok && data.result) {
      return {
        ok: true,
        name: data.result.first_name ?? "Bot",
        username: data.result.username ?? "",
        id: data.result.id ?? 0,
      };
    }
    if (res.status === 401) {
      return {
        ok: false,
        error:
          "Telegram says this bot token is unauthorized. Most common causes: (1) the token was revoked or regenerated (open @BotFather → /mybots → your bot → API Token → re-copy), (2) you pasted only part of the token, or (3) you pasted a stale token from a different bot.",
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        error:
          "Telegram doesn't recognize this bot token. The bot may have been deleted, or the digits before the colon are wrong. Re-copy from @BotFather.",
      };
    }
    return {
      ok: false,
      error: data?.description ?? `Telegram returned HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function validateDiscord(token: string): Promise<ValidationOk | ValidationFail> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { authorization: `Bot ${token}` },
    });
    const data = (await res.json().catch(() => null)) as {
      id?: string;
      username?: string;
      global_name?: string;
      message?: string;
    } | null;
    if (res.ok && data?.id) {
      return {
        ok: true,
        name: data.global_name ?? data.username ?? "Bot",
        username: data.username ?? "",
        id: data.id ?? "",
      };
    }
    return { ok: false, error: data?.message ?? `Discord returned HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function validateSlack(
  botToken: string,
  appToken: string,
): Promise<ValidationOk | ValidationFail> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        authorization: `Bearer ${botToken}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      team?: string;
      user?: string;
      bot_id?: string;
      error?: string;
    } | null;
    if (!data?.ok) {
      return { ok: false, error: `Slack botToken: ${data?.error ?? `HTTP ${res.status}`}` };
    }
    if (!appToken.startsWith("xapp-")) {
      return {
        ok: false,
        error:
          "appToken should start with xapp- (it's the App-Level Token, not the Bot OAuth Token)",
      };
    }
    return {
      ok: true,
      team: data.team ?? "",
      user: data.user ?? "",
      botId: data.bot_id ?? "",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ------ persistence ------

type ChannelsFlagFile = {
  readonly version: 1;
  readonly enabled: Record<ChannelId, true>;
};

const CHANNELS_FILE_NAME = "channels.json";

function channelsFlagPath(): string {
  return path.join(resolveStateDir(), CHANNELS_FILE_NAME);
}

async function readChannelsFlag(): Promise<ChannelsFlagFile> {
  try {
    const raw = await fs.readFile(channelsFlagPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { version?: number }).version === 1 &&
      typeof (parsed as { enabled?: unknown }).enabled === "object"
    ) {
      return parsed as ChannelsFlagFile;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logWarn(`channels-wizard: failed to read channels.json (${(err as Error).message})`);
    }
  }
  return { version: 1, enabled: {} as ChannelsFlagFile["enabled"] };
}

async function writeChannelsFlag(file: ChannelsFlagFile): Promise<void> {
  const filePath = channelsFlagPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

type SaveResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

async function saveChannel(
  channel: ChannelId,
  credentials: Record<string, unknown>,
): Promise<SaveResult> {
  try {
    if (channel === "telegram") {
      const botToken = readStr(credentials.botToken);
      if (!botToken) return { ok: false, error: "Missing botToken" };
      setKeychainSecret({ service: "alien.ai", account: "telegram-bot-token" }, botToken);
    } else if (channel === "discord") {
      const token = readStr(credentials.token);
      if (!token) return { ok: false, error: "Missing token" };
      setKeychainSecret({ service: "alien.ai", account: "discord-bot-token" }, token);
    } else if (channel === "slack") {
      const botToken = readStr(credentials.botToken);
      const appToken = readStr(credentials.appToken);
      if (!botToken || !appToken) return { ok: false, error: "Missing botToken or appToken" };
      setKeychainSecret({ service: "alien.ai", account: "slack-bot-token" }, botToken);
      setKeychainSecret({ service: "alien.ai", account: "slack-app-token" }, appToken);
    } else if (channel === "whatsapp") {
      // No credentials at this step — pairing happens via QR after the
      // channel is enabled and restarted. The flag tells the next gateway
      // boot to bring WhatsApp online.
    } else if (channel === "imessage") {
      // No credentials — macOS reads chat.db directly. The user grants
      // Full Disk Access in System Settings; we just flip the flag.
    }
    const file = await readChannelsFlag();
    const next: ChannelsFlagFile = {
      version: 1,
      enabled: { ...file.enabled, [channel]: true } as ChannelsFlagFile["enabled"],
    };
    await writeChannelsFlag(next);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function readChannelsStatus(): Promise<{
  readonly configured: ReadonlyArray<ChannelId>;
}> {
  const file = await readChannelsFlag();
  return { configured: Object.keys(file.enabled) as ChannelId[] };
}

// ------ helpers ------

function badRequest(res: ServerResponse, message: string): true {
  sendInvalidRequest(res, message);
  return true;
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.startsWith("::ffff:127.")
  );
}

function readStr(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

// ------ HTML pages ------

const SHARED_CSS = `
  :root {
    --bg: #faf8f4; --ink: #1a1714; --muted: #6b6258; --line: #e6dfd2;
    --gold: #b8923c; --gold-deep: #8e6e22; --ok: #2f7a4b; --err: #b53939;
    --field: #fff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex; align-items: flex-start; justify-content: center; padding: 32px 20px; }
  .card { max-width: 640px; width: 100%; background: #fff; border: 1px solid var(--line);
    border-radius: 16px; padding: 32px 36px; box-shadow: 0 4px 22px rgba(0,0,0,.04); }
  .crumb { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
  .crumb a { color: var(--gold-deep); text-decoration: none; }
  .crumb a:hover { text-decoration: underline; }
  h1 { font-size: 26px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 4px; }
  .tag { color: var(--muted); margin: 0 0 24px; font-size: 15px; }
  h2 { font-size: 17px; margin: 22px 0 6px; font-weight: 600; }
  .step { border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; margin: 0 0 12px; }
  .step-head { display: flex; gap: 10px; align-items: baseline; margin: 0 0 6px; }
  .step-num { display: inline-flex; width: 22px; height: 22px; border-radius: 99px;
    background: var(--ink); color: #fff; font-size: 12px; font-weight: 600; line-height: 22px;
    text-align: center; justify-content: center; align-items: center; flex-shrink: 0; }
  .step-title { font-weight: 600; font-size: 15px; margin: 0; }
  .step-body { font-size: 14px; color: var(--muted); margin: 0; }
  .step-body p { margin: 0 0 8px; }
  .step-body p:last-child { margin: 0; }
  .step-body code { background: #f4ecd9; padding: 1px 6px; border-radius: 4px;
    font-size: 13px; color: var(--gold-deep); }
  a.btn { display: inline-block; padding: 8px 14px; border: 1px solid var(--line);
    border-radius: 8px; background: #fff; color: var(--ink); font-weight: 500;
    text-decoration: none; font-size: 14px; margin: 4px 0; }
  a.btn:hover { border-color: var(--gold); background: #fbf6e8; }
  a.btn.primary { background: var(--ink); color: #fff; border-color: var(--ink); }
  a.btn.primary:hover { background: var(--gold-deep); border-color: var(--gold-deep); }
  textarea, input[type="password"], input[type="text"] {
    width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--field); font: inherit; color: var(--ink); font-size: 14px; }
  textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical;
    min-height: 100px; }
  input:focus, textarea:focus { outline: 2px solid var(--gold); outline-offset: -1px;
    border-color: var(--gold); }
  .field-row { display: flex; gap: 6px; margin: 8px 0 4px; }
  .field-row input { flex: 1; }
  button { padding: 10px 16px; border: 1px solid var(--line); border-radius: 8px;
    background: #fff; font: inherit; font-weight: 500; cursor: pointer; color: var(--ink); }
  button:hover { border-color: var(--gold); }
  button:disabled { opacity: .5; cursor: default; }
  button.primary { background: var(--ink); color: #fff; border-color: var(--ink);
    padding: 13px 22px; font-size: 15px; font-weight: 600; width: 100%; margin-top: 6px; }
  button.primary:hover { background: var(--gold-deep); border-color: var(--gold-deep); }
  .status { font-size: 13px; margin: 6px 0 0; min-height: 18px; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }
  .status.info { color: var(--muted); }
  .err-banner { background: #fdecec; border: 1px solid #f4caca; color: var(--err);
    padding: 10px 12px; border-radius: 8px; margin: 12px 0 0; font-size: 14px; display: none; }
  .err-banner.show { display: block; }
  .success { background: #eef8f0; border: 1px solid #c4e3cd; color: var(--ok);
    padding: 14px 16px; border-radius: 10px; margin: 12px 0; font-size: 14px; }
  .channel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0; }
  @media (max-width: 540px) { .channel-grid { grid-template-columns: 1fr; } }
  .channel-card { display: block; padding: 16px 18px; border: 1px solid var(--line);
    border-radius: 12px; background: #fff; color: var(--ink); text-decoration: none;
    transition: border-color .15s; }
  .channel-card:hover { border-color: var(--gold); background: #fbf6e8; }
  .channel-card.soon { opacity: .55; cursor: default; }
  .channel-card.soon:hover { border-color: var(--line); background: #fff; }
  .channel-card.configured { border-color: var(--ok); background: #f6fbf7; }
  .channel-card-head { display: flex; align-items: center; justify-content: space-between;
    margin: 0 0 6px; }
  .channel-card-name { font-weight: 600; font-size: 15px; margin: 0; }
  .channel-card-badge { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 99px;
    text-transform: uppercase; letter-spacing: .04em; }
  .channel-card-badge.easy { background: #ddeede; color: var(--ok); }
  .channel-card-badge.medium { background: #f4ecd9; color: var(--gold-deep); }
  .channel-card-badge.soon { background: #f0ece4; color: var(--muted); }
  .channel-card-badge.done { background: #ddeede; color: var(--ok); }
  .channel-card-desc { font-size: 13px; color: var(--muted); margin: 0; }
  .toolbar { display: flex; gap: 10px; margin: 20px 0 0; }
  .toolbar .spacer { flex: 1; }
`;

function renderPickerHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect a channel</title><style>${SHARED_CSS}</style>
</head><body>
<div class="card">
  <p class="crumb"><a href="/setup">← Setup</a></p>
  <h1>Connect a channel</h1>
  <p class="tag">Add messaging where your Alien team talks to you. Pick the easiest one for now — you can add more later.</p>
  <h2 style="margin-top:8px">Easy to set up</h2>
  <div class="channel-grid">
    <a class="channel-card" href="/setup/channels/telegram">
      <div class="channel-card-head">
        <p class="channel-card-name">Telegram</p>
        <span class="channel-card-badge easy">30 sec</span>
      </div>
      <p class="channel-card-desc">Chat with your bot on Telegram. Easiest channel — just a quick chat with @BotFather.</p>
    </a>
    <a class="channel-card" href="/setup/channels/discord">
      <div class="channel-card-head">
        <p class="channel-card-name">Discord</p>
        <span class="channel-card-badge easy">90 sec</span>
      </div>
      <p class="channel-card-desc">Invite a bot to your server. Great for communities or personal use.</p>
    </a>
  </div>
  <h2>A bit more setup</h2>
  <div class="channel-grid">
    <a class="channel-card" href="/setup/channels/slack">
      <div class="channel-card-head">
        <p class="channel-card-name">Slack</p>
        <span class="channel-card-badge medium">2-3 min</span>
      </div>
      <p class="channel-card-desc">Install an app to your workspace and copy two tokens. Best for work teams.</p>
    </a>
    <a class="channel-card" href="/setup/channels/whatsapp">
      <div class="channel-card-head">
        <p class="channel-card-name">WhatsApp</p>
        <span class="channel-card-badge easy">1 min</span>
      </div>
      <p class="channel-card-desc">Pair with your phone via QR, just like WhatsApp Web. Needs a restart to bring up the QR.</p>
    </a>
    <a class="channel-card" href="/setup/channels/imessage">
      <div class="channel-card-head">
        <p class="channel-card-name">iMessage (macOS)</p>
        <span class="channel-card-badge easy">1 min</span>
      </div>
      <p class="channel-card-desc">No tokens — grant Full Disk Access to your terminal and Alien reads Messages.app directly.</p>
    </a>
  </div>
  <h2>Coming soon</h2>
  <div class="channel-grid">
    ${comingSoonCard("Matrix", "Federated chat with your own homeserver")}
    ${comingSoonCard("Signal", "Phone-paired E2E chat")}
    ${comingSoonCard("Google Chat", "Workspace OAuth")}
    ${comingSoonCard("Mattermost / Teams", "Enterprise chat platforms")}
  </div>
  <div class="toolbar">
    <a class="btn" href="/setup/channels-done">Skip for now →</a>
    <div class="spacer"></div>
    <a class="btn primary" href="/setup/channels-done">I'm done →</a>
  </div>
</div>
${pickerScript()}
</body></html>`;
}

function comingSoonCard(name: string, desc: string): string {
  return `<div class="channel-card soon">
    <div class="channel-card-head">
      <p class="channel-card-name">${name}</p>
      <span class="channel-card-badge soon">soon</span>
    </div>
    <p class="channel-card-desc">${desc}</p>
  </div>`;
}

function pickerScript(): string {
  return `<script>
(() => {
  // Mark already-configured channels with a green badge.
  fetch("/v1/setup/channels/status", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    .then((r) => r.json()).then((data) => {
      if (!data || !Array.isArray(data.configured)) return;
      for (const channel of data.configured) {
        const card = document.querySelector('a.channel-card[href$="/' + channel + '"]');
        if (!card) continue;
        card.classList.add("configured");
        const badge = card.querySelector(".channel-card-badge");
        if (badge) {
          badge.textContent = "connected";
          badge.className = "channel-card-badge done";
        }
      }
    }).catch(() => {});
  // The "I'm done" + "Skip" buttons go to a server route that handles token
  // handoff back to the main UI. Implemented as a tiny client redirect for
  // now — the gateway's loopback handler will redirect / to /#token=...
  document.querySelectorAll('a[href="/setup/channels-done"]').forEach((a) => {
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      window.location.href = "/";
    });
  });
})();
</script>`;
}

// ---- Telegram wizard ----

function renderTelegramWizardHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Telegram</title><style>${SHARED_CSS}</style>
</head><body>
<div class="card">
  <p class="crumb"><a href="/setup/channels">← Channels</a></p>
  <h1>Connect Telegram</h1>
  <p class="tag">Set up in 30 seconds. You'll chat with @BotFather to create a bot.</p>

  <div class="step">
    <div class="step-head"><span class="step-num">1</span><p class="step-title">Open Telegram and chat with @BotFather</p></div>
    <div class="step-body">
      <p>Search for <code>@BotFather</code> in Telegram (it has a blue checkmark — there are fakes).</p>
      <p><a class="btn" href="https://t.me/BotFather" target="_blank" rel="noopener">Open @BotFather →</a></p>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">2</span><p class="step-title">Send <code>/newbot</code></p></div>
    <div class="step-body">
      <p>BotFather will ask for two things:</p>
      <p>• <strong>A display name</strong> (e.g., "My Alien")<br>• <strong>A username ending in 'bot'</strong> (e.g., <code>myalien_bot</code>)</p>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">3</span><p class="step-title">Copy the bot token</p></div>
    <div class="step-body">
      <p>BotFather replies with a token that looks like <code>1234567890:ABC-...</code>. Copy the whole thing and paste below.</p>
      <div class="field-row">
        <input id="botToken" type="password" placeholder="1234567890:ABC-..." autocomplete="off" spellcheck="false">
        <button id="validate" type="button">Test</button>
      </div>
      <div id="status" class="status"></div>
    </div>
  </div>

  <button id="save" class="primary" type="button">Connect Telegram</button>
  <div id="err" class="err-banner"></div>
  <div id="done" class="success" style="display:none">
    <strong>✓ Telegram connected!</strong> Start a chat with your bot — restart Alien for it to come online.
  </div>
  <div class="toolbar">
    <a class="btn" href="/setup/channels">← Pick a different channel</a>
    <div class="spacer"></div>
  </div>
</div>
${telegramScript()}
</body></html>`;
}

function telegramScript(): string {
  return `<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let validated = null;
  const setStatus = (kind, msg) => {
    $("status").className = "status " + kind;
    $("status").textContent = msg || "";
  };
  async function postJson(p, b) {
    const r = await fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return r.json().catch(() => null);
  }
  $("validate").addEventListener("click", async () => {
    const tok = $("botToken").value.trim();
    if (!tok) { setStatus("err", "Paste the bot token first."); return; }
    $("validate").disabled = true; setStatus("info", "Testing...");
    const d = await postJson("/v1/setup/channels/validate-telegram", { botToken: tok });
    $("validate").disabled = false;
    if (d && d.ok) { validated = tok; setStatus("ok", "✓ Found @" + (d.username || "your-bot") + " — looks good."); }
    else { validated = null; setStatus("err", (d && d.error) || "Could not validate."); }
  });
  $("save").addEventListener("click", async () => {
    const tok = $("botToken").value.trim();
    if (!tok) { showErr("Paste the bot token first."); return; }
    if (validated !== tok) {
      $("validate").click();
      await new Promise((r) => setTimeout(r, 1500));
      if (validated !== tok) { showErr("Token didn't validate. Fix above and try again."); return; }
    }
    $("save").disabled = true; $("save").textContent = "Saving...";
    const r = await postJson("/v1/setup/channels/save", { channel: "telegram", credentials: { botToken: tok } });
    if (r && r.ok) { $("done").style.display = "block"; $("save").textContent = "✓ Saved"; }
    else { $("save").disabled = false; $("save").textContent = "Connect Telegram"; showErr((r && r.error) || "Save failed."); }
  });
  function showErr(m) { $("err").textContent = m; $("err").classList.add("show"); }
})();
</script>`;
}

// ---- Discord wizard ----

function renderDiscordWizardHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Discord</title><style>${SHARED_CSS}</style>
</head><body>
<div class="card">
  <p class="crumb"><a href="/setup/channels">← Channels</a></p>
  <h1>Connect Discord</h1>
  <p class="tag">Set up in about 90 seconds. You'll create an app + bot in the Discord Developer Portal.</p>

  <div class="step">
    <div class="step-head"><span class="step-num">1</span><p class="step-title">Open the Discord Developer Portal</p></div>
    <div class="step-body">
      <p><a class="btn" href="https://discord.com/developers/applications" target="_blank" rel="noopener">discord.com/developers/applications →</a></p>
      <p>Click <strong>New Application</strong>, name it (e.g., "My Alien"), accept the terms, then <strong>Create</strong>.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">2</span><p class="step-title">Get the bot token</p></div>
    <div class="step-body">
      <p>In your new app's sidebar, click <strong>Bot</strong>. Click <strong>Reset Token</strong> (or <strong>Copy</strong>) and copy the value — Discord only shows it once.</p>
      <p>While you're on this page, turn ON <strong>Message Content Intent</strong> at the bottom (Privileged Gateway Intents). Save changes.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">3</span><p class="step-title">Paste the token here</p></div>
    <div class="step-body">
      <div class="field-row">
        <input id="token" type="password" placeholder="MTAxNzc2..." autocomplete="off" spellcheck="false">
        <button id="validate" type="button">Test</button>
      </div>
      <div id="status" class="status"></div>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">4</span><p class="step-title">Invite the bot to your server</p></div>
    <div class="step-body">
      <p>After saving below, go back to the Developer Portal → <strong>OAuth2</strong> → <strong>URL Generator</strong>. Check <code>bot</code> and <code>applications.commands</code>. In Bot Permissions, check at least <code>Send Messages</code> and <code>Read Message History</code>. Open the generated URL, pick a server, and invite.</p>
    </div>
  </div>

  <button id="save" class="primary" type="button">Connect Discord</button>
  <div id="err" class="err-banner"></div>
  <div id="done" class="success" style="display:none">
    <strong>✓ Discord connected!</strong> Restart Alien for it to come online, then DM your bot or @-mention it in a server channel.
  </div>
  <div class="toolbar">
    <a class="btn" href="/setup/channels">← Pick a different channel</a>
    <div class="spacer"></div>
  </div>
</div>
${discordScript()}
</body></html>`;
}

function discordScript(): string {
  return `<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let validated = null;
  const setStatus = (kind, msg) => {
    $("status").className = "status " + kind;
    $("status").textContent = msg || "";
  };
  async function postJson(p, b) {
    const r = await fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return r.json().catch(() => null);
  }
  $("validate").addEventListener("click", async () => {
    const tok = $("token").value.trim();
    if (!tok) { setStatus("err", "Paste the token first."); return; }
    $("validate").disabled = true; setStatus("info", "Testing...");
    const d = await postJson("/v1/setup/channels/validate-discord", { token: tok });
    $("validate").disabled = false;
    if (d && d.ok) { validated = tok; setStatus("ok", "✓ Found bot \\"" + (d.name || "Bot") + "\\" — looks good."); }
    else { validated = null; setStatus("err", (d && d.error) || "Could not validate."); }
  });
  $("save").addEventListener("click", async () => {
    const tok = $("token").value.trim();
    if (!tok) { showErr("Paste the token first."); return; }
    if (validated !== tok) {
      $("validate").click();
      await new Promise((r) => setTimeout(r, 1500));
      if (validated !== tok) { showErr("Token didn't validate. Fix above and try again."); return; }
    }
    $("save").disabled = true; $("save").textContent = "Saving...";
    const r = await postJson("/v1/setup/channels/save", { channel: "discord", credentials: { token: tok } });
    if (r && r.ok) { $("done").style.display = "block"; $("save").textContent = "✓ Saved"; }
    else { $("save").disabled = false; $("save").textContent = "Connect Discord"; showErr((r && r.error) || "Save failed."); }
  });
  function showErr(m) { $("err").textContent = m; $("err").classList.add("show"); }
})();
</script>`;
}

// ---- Slack wizard ----

function renderSlackWizardHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Slack</title><style>${SHARED_CSS}</style>
</head><body>
<div class="card">
  <p class="crumb"><a href="/setup/channels">← Channels</a></p>
  <h1>Connect Slack</h1>
  <p class="tag">Most setup of the three — about 2-3 minutes. You'll create a Slack app and copy two tokens.</p>

  <div class="step">
    <div class="step-head"><span class="step-num">1</span><p class="step-title">Open Slack's app creator</p></div>
    <div class="step-body">
      <p><a class="btn" href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noopener">api.slack.com/apps →</a></p>
      <p>Click <strong>Create New App</strong> → <strong>From an app manifest</strong>. Pick your workspace, then paste this manifest:</p>
      <textarea readonly onclick="this.select()">display_information:
  name: My Alien
features:
  bot_user:
    display_name: My Alien
    always_online: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - chat:write
      - im:history
      - im:read
      - im:write
      - users:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.im
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
  token_rotation_enabled: false</textarea>
      <p>Click <strong>Next</strong>, then <strong>Create</strong>.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">2</span><p class="step-title">Install to your workspace</p></div>
    <div class="step-body">
      <p>On your new app's page, click <strong>Install to Workspace</strong> (top of the page or via OAuth & Permissions). Approve in Slack.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">3</span><p class="step-title">Copy the Bot User OAuth Token</p></div>
    <div class="step-body">
      <p>Under <strong>OAuth & Permissions</strong>, copy the <strong>Bot User OAuth Token</strong> (starts with <code>xoxb-</code>).</p>
      <div class="field-row">
        <input id="botToken" type="password" placeholder="xoxb-..." autocomplete="off" spellcheck="false">
      </div>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">4</span><p class="step-title">Generate an App-Level Token</p></div>
    <div class="step-body">
      <p>Go to <strong>Basic Information</strong> (left sidebar) → scroll to <strong>App-Level Tokens</strong> → <strong>Generate Token and Scopes</strong>. Name it "socket", add scope <code>connections:write</code>, click <strong>Generate</strong>. Copy the token (starts with <code>xapp-</code>).</p>
      <div class="field-row">
        <input id="appToken" type="password" placeholder="xapp-..." autocomplete="off" spellcheck="false">
        <button id="validate" type="button">Test both</button>
      </div>
      <div id="status" class="status"></div>
    </div>
  </div>

  <button id="save" class="primary" type="button">Connect Slack</button>
  <div id="err" class="err-banner"></div>
  <div id="done" class="success" style="display:none">
    <strong>✓ Slack connected!</strong> Restart Alien for it to come online, then DM your bot or @-mention it in any channel.
  </div>
  <div class="toolbar">
    <a class="btn" href="/setup/channels">← Pick a different channel</a>
    <div class="spacer"></div>
  </div>
</div>
${slackScript()}
</body></html>`;
}

// ---- WhatsApp wizard ----

function renderWhatsAppWizardHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect WhatsApp</title><style>${SHARED_CSS}</style>
</head><body>
<div class="card">
  <p class="crumb"><a href="/setup/channels">← Channels</a></p>
  <h1>Connect WhatsApp</h1>
  <p class="tag">~1 minute. Pairing happens by scanning a QR code with your phone, just like WhatsApp Web.</p>

  <div class="step">
    <div class="step-head"><span class="step-num">1</span><p class="step-title">Click "Enable WhatsApp"</p></div>
    <div class="step-body">
      <p>That tells Alien to bring WhatsApp online on the next restart. Pairing happens at boot.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">2</span><p class="step-title">Restart Alien</p></div>
    <div class="step-body">
      <p>In your terminal, restart the gateway so the WhatsApp plugin can boot:</p>
      <p><code>pnpm alien --dev gateway run</code></p>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">3</span><p class="step-title">Scan the QR code with your phone</p></div>
    <div class="step-body">
      <p>The gateway logs print a QR. On your phone:</p>
      <p>WhatsApp → Settings → <strong>Linked Devices</strong> → <strong>Link a Device</strong> → point the camera at the QR in the terminal.</p>
      <p style="color: var(--gold-deep); font-size: 13px;">Heads up: WhatsApp's Linked Devices flow can ask for biometric confirmation. Once paired the session persists until you remove it from WhatsApp.</p>
    </div>
  </div>

  <button id="save" class="primary" type="button">Enable WhatsApp</button>
  <div id="err" class="err-banner"></div>
  <div id="done" class="success" style="display:none">
    <strong>✓ WhatsApp enabled.</strong> Restart the gateway, then scan the QR from your phone's Linked Devices screen.
  </div>
  <div class="toolbar">
    <a class="btn" href="/setup/channels">← Pick a different channel</a>
    <div class="spacer"></div>
  </div>
</div>
${whatsappScript()}
</body></html>`;
}

function whatsappScript(): string {
  return `<script>
(() => {
  const $ = (id) => document.getElementById(id);
  async function postJson(p, b) {
    const r = await fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return r.json().catch(() => null);
  }
  $("save").addEventListener("click", async () => {
    $("save").disabled = true; $("save").textContent = "Saving...";
    const r = await postJson("/v1/setup/channels/save", { channel: "whatsapp", credentials: {} });
    if (r && r.ok) { $("done").style.display = "block"; $("save").textContent = "✓ Enabled"; }
    else { $("save").disabled = false; $("save").textContent = "Enable WhatsApp"; $("err").textContent = (r && r.error) || "Save failed."; $("err").classList.add("show"); }
  });
})();
</script>`;
}

// ---- iMessage wizard ----

function renderIMessageWizardHtml(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect iMessage</title><style>${SHARED_CSS}</style>
</head><body>
<div class="card">
  <p class="crumb"><a href="/setup/channels">← Channels</a></p>
  <h1>Connect iMessage</h1>
  <p class="tag">macOS only. No tokens — Alien reads <code>Messages.app</code> directly through the system database.</p>

  <div id="non-mac" class="err-banner" style="margin: 12px 0; display: none">
    iMessage only works on macOS. Skip this one and pick a different channel.
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">1</span><p class="step-title">Grant Full Disk Access to your terminal</p></div>
    <div class="step-body">
      <p>macOS protects <code>chat.db</code> behind Full Disk Access. You need to give it to whatever runs Alien (usually your terminal app — Terminal.app, iTerm, etc.).</p>
      <p>Open System Settings → <strong>Privacy &amp; Security</strong> → <strong>Full Disk Access</strong> → click <strong>+</strong> and add your terminal app.</p>
      <p><a class="btn" href="x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" target="_blank">Open Full Disk Access settings →</a></p>
      <p style="font-size: 13px; color: var(--gold-deep);">After adding, you'll need to quit + reopen your terminal for it to take effect.</p>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">2</span><p class="step-title">Check permission</p></div>
    <div class="step-body">
      <p>Once you've granted access and reopened your terminal:</p>
      <div class="field-row">
        <button id="check" type="button">Check permission</button>
      </div>
      <div id="check-status" class="status"></div>
    </div>
  </div>

  <div class="step">
    <div class="step-head"><span class="step-num">3</span><p class="step-title">Enable iMessage</p></div>
    <div class="step-body">
      <p>Click below to enable the channel. After restart, Alien starts watching new messages and can reply through Messages.app.</p>
    </div>
  </div>

  <button id="save" class="primary" type="button">Enable iMessage</button>
  <div id="err" class="err-banner"></div>
  <div id="done" class="success" style="display:none">
    <strong>✓ iMessage enabled.</strong> Restart the gateway to bring it online.
  </div>
  <div class="toolbar">
    <a class="btn" href="/setup/channels">← Pick a different channel</a>
    <div class="spacer"></div>
  </div>
</div>
${imessageScript()}
</body></html>`;
}

function imessageScript(): string {
  return `<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const setStatus = (kind, msg) => { $("check-status").className = "status " + kind; $("check-status").textContent = msg || ""; };
  async function postJson(p, b) {
    const r = await fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) });
    return r.json().catch(() => null);
  }
  // Probe permission immediately on load so the user sees current state.
  postJson("/v1/setup/channels/imessage-permission").then((d) => {
    if (!d) return;
    if (d.platform !== "darwin") {
      $("non-mac").style.display = "block";
      $("check").disabled = true; $("save").disabled = true;
      return;
    }
    if (d.hasFullDiskAccess) {
      setStatus("ok", "✓ Full Disk Access is granted.");
    } else {
      setStatus("info", "Not yet granted. Add your terminal above, then click Check.");
    }
  });
  $("check").addEventListener("click", async () => {
    $("check").disabled = true; setStatus("info", "Checking...");
    const d = await postJson("/v1/setup/channels/imessage-permission");
    $("check").disabled = false;
    if (d && d.hasFullDiskAccess) setStatus("ok", "✓ Full Disk Access is granted.");
    else setStatus("err", "Still no access. Did you add your terminal and reopen it?");
  });
  $("save").addEventListener("click", async () => {
    $("save").disabled = true; $("save").textContent = "Saving...";
    const r = await postJson("/v1/setup/channels/save", { channel: "imessage", credentials: {} });
    if (r && r.ok) { $("done").style.display = "block"; $("save").textContent = "✓ Enabled"; }
    else { $("save").disabled = false; $("save").textContent = "Enable iMessage"; $("err").textContent = (r && r.error) || "Save failed."; $("err").classList.add("show"); }
  });
})();
</script>`;
}

function slackScript(): string {
  return `<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let validated = null;
  const setStatus = (kind, msg) => {
    $("status").className = "status " + kind;
    $("status").textContent = msg || "";
  };
  async function postJson(p, b) {
    const r = await fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return r.json().catch(() => null);
  }
  $("validate").addEventListener("click", async () => {
    const bot = $("botToken").value.trim();
    const app = $("appToken").value.trim();
    if (!bot || !app) { setStatus("err", "Paste both tokens first."); return; }
    $("validate").disabled = true; setStatus("info", "Testing...");
    const d = await postJson("/v1/setup/channels/validate-slack", { botToken: bot, appToken: app });
    $("validate").disabled = false;
    if (d && d.ok) { validated = bot + "|" + app; setStatus("ok", "✓ Connected to " + (d.team || "your workspace") + " as " + (d.user || "your bot") + "."); }
    else { validated = null; setStatus("err", (d && d.error) || "Could not validate."); }
  });
  $("save").addEventListener("click", async () => {
    const bot = $("botToken").value.trim();
    const app = $("appToken").value.trim();
    if (!bot || !app) { showErr("Paste both tokens first."); return; }
    if (validated !== bot + "|" + app) {
      $("validate").click();
      await new Promise((r) => setTimeout(r, 1500));
      if (validated !== bot + "|" + app) { showErr("Tokens didn't validate. Fix above and try again."); return; }
    }
    $("save").disabled = true; $("save").textContent = "Saving...";
    const r = await postJson("/v1/setup/channels/save", { channel: "slack", credentials: { botToken: bot, appToken: app } });
    if (r && r.ok) { $("done").style.display = "block"; $("save").textContent = "✓ Saved"; }
    else { $("save").disabled = false; $("save").textContent = "Connect Slack"; showErr((r && r.error) || "Save failed."); }
  });
  function showErr(m) { $("err").textContent = m; $("err").classList.add("show"); }
})();
</script>`;
}
