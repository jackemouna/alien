import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import type {
  ChannelAccountSnapshot,
  ChannelUiMetaEntry,
  ChannelsStatusSnapshot,
  DiscordStatus,
  GoogleChatStatus,
  IMessageStatus,
  NostrProfile,
  NostrStatus,
  SignalStatus,
  SlackStatus,
  TelegramStatus,
  WhatsAppStatus,
} from "../types.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import { renderDiscordCard } from "./channels.discord.ts";
import { renderGoogleChatCard } from "./channels.googlechat.ts";
import { renderIMessageCard } from "./channels.imessage.ts";
import { renderNostrCard } from "./channels.nostr.ts";
import {
  channelEnabled,
  formatNullableBoolean,
  renderChannelAccountCount,
  resolveChannelDisplayState,
} from "./channels.shared.ts";
import { renderSignalCard } from "./channels.signal.ts";
import { renderSlackCard } from "./channels.slack.ts";
import { renderTelegramCard } from "./channels.telegram.ts";
import type { ChannelKey, ChannelsChannelData, ChannelsProps } from "./channels.types.ts";
import { renderWhatsAppCard } from "./channels.whatsapp.ts";

export function renderChannels(props: ChannelsProps) {
  const channels = props.snapshot?.channels as Record<string, unknown> | null;
  const whatsapp = (channels?.whatsapp ?? undefined) as WhatsAppStatus | undefined;
  const telegram = (channels?.telegram ?? undefined) as TelegramStatus | undefined;
  const discord = (channels?.discord ?? null) as DiscordStatus | null;
  const googlechat = (channels?.googlechat ?? null) as GoogleChatStatus | null;
  const slack = (channels?.slack ?? null) as SlackStatus | null;
  const signal = (channels?.signal ?? null) as SignalStatus | null;
  const imessage = (channels?.imessage ?? null) as IMessageStatus | null;
  const nostr = (channels?.nostr ?? null) as NostrStatus | null;
  const channelOrder = resolveChannelOrder(props.snapshot);
  const orderedChannels = channelOrder
    .map((key, index) => ({
      key,
      enabled: channelEnabled(key, props),
      order: index,
    }))
    .toSorted((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      return a.order - b.order;
    });
  const showingStaleSnapshot = Boolean(props.loading && props.snapshot && props.lastSuccessAt);
  const partialWarnings = props.snapshot?.warnings?.filter((warning) => warning.trim()) ?? [];

  return html`
    <section style="margin-bottom: 16px;">
      <div style="margin: 0 0 12px;">
        <div style="font-size: 18px; font-weight: 600; margin: 0 0 2px;">Channels</div>
        <div style="color: var(--muted, #6b6258); font-size: 13px;">
          Pick a channel to set it up. Click again later to edit or disconnect.
        </div>
      </div>
      <div
        style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;"
      >
        ${CLEAN_CHANNELS.map((c) => renderCleanChannelCard(c, channelEnabled(c.key, props)))}
      </div>
    </section>

    <details style="margin-top: 24px;">
      <summary
        style="cursor: pointer; color: var(--muted, #6b6258); font-size: 14px; padding: 6px 0;"
      >
        Advanced — runtime status &amp; raw config
      </summary>
      <section class="grid grid-cols-2" style="margin-top: 12px;">
        ${orderedChannels.map((channel) =>
          renderChannel(channel.key, props, {
            whatsapp,
            telegram,
            discord,
            googlechat,
            slack,
            signal,
            imessage,
            nostr,
            channelAccounts: props.snapshot?.channelAccounts ?? null,
          }),
        )}
      </section>

      <section class="card" style="margin-top: 18px;">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">${t("channels.health.title")}</div>
            <div class="card-sub">${t("channels.health.subtitle")}</div>
          </div>
          <div class="muted">
            ${props.lastSuccessAt ? formatRelativeTimestamp(props.lastSuccessAt) : t("common.na")}
          </div>
        </div>
        ${showingStaleSnapshot
          ? html`
              <div class="callout info" style="margin-top: 12px;">
                Refreshing channel status in the background; showing the last successful snapshot.
              </div>
            `
          : nothing}
        ${props.snapshot?.partial
          ? html`
              <div class="callout warn" style="margin-top: 12px;">
                Some channel checks did not finish before the UI budget.
                ${partialWarnings.length > 0 ? partialWarnings.slice(0, 3).join("; ") : ""}
              </div>
            `
          : nothing}
        ${props.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.lastError}</div>`
          : nothing}
        <pre class="code-block" style="margin-top: 12px;">
${props.snapshot ? JSON.stringify(props.snapshot, null, 2) : t("channels.health.noSnapshotYet")}
        </pre
        >
      </section>
    </details>
  `;
}

type CleanChannel = {
  readonly key: ChannelKey;
  readonly name: string;
  readonly icon: string;
  readonly setupTime: string;
  readonly slug: string;
};

const CLEAN_CHANNELS: ReadonlyArray<CleanChannel> = [
  { key: "telegram", name: "Telegram", icon: "✈", setupTime: "30 sec", slug: "telegram" },
  { key: "discord", name: "Discord", icon: "💬", setupTime: "90 sec", slug: "discord" },
  { key: "slack", name: "Slack", icon: "#", setupTime: "2-3 min", slug: "slack" },
  { key: "whatsapp", name: "WhatsApp", icon: "🟢", setupTime: "1 min", slug: "whatsapp" },
  { key: "imessage", name: "iMessage", icon: "💙", setupTime: "1 min", slug: "imessage" },
  { key: "signal", name: "Signal", icon: "📨", setupTime: "soon", slug: "" },
  { key: "googlechat", name: "Google Chat", icon: "🅖", setupTime: "soon", slug: "" },
  { key: "nostr", name: "Nostr", icon: "⚡", setupTime: "soon", slug: "" },
];

function renderCleanChannelCard(c: CleanChannel, connected: boolean) {
  const hasWizard = c.slug.length > 0;
  const href = hasWizard ? `/setup/channels/${c.slug}` : undefined;
  const statusLabel = connected ? "Connected" : hasWizard ? "Not set up" : "Coming soon";
  const statusColor = connected ? "#2f7a4b" : hasWizard ? "#6b6258" : "#a8a195";
  const borderColor = connected ? "#c4e3cd" : "#e6dfd2";
  const bg = connected ? "#f6fbf7" : "#fff";
  const card = html`
    <div
      style="position: relative; padding: 16px 18px; border: 1px solid ${borderColor};
                border-radius: 12px; background: ${bg};
                opacity: ${hasWizard ? "1" : "0.6"};
                ${hasWizard ? "cursor: pointer;" : ""}"
    >
      <div
        style="display: flex; justify-content: space-between; align-items: flex-start; margin: 0 0 8px;"
      >
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 20px;">${c.icon}</span>
          <span style="font-weight: 600; font-size: 15px;">${c.name}</span>
        </div>
        ${connected
          ? html`<span
              style="font-size: 11px; font-weight: 600; padding: 2px 8px;
                          border-radius: 99px; background: #ddeede; color: #2f7a4b;
                          text-transform: uppercase; letter-spacing: .04em;"
              >✓</span
            >`
          : nothing}
      </div>
      <div style="font-size: 13px; color: ${statusColor};">${statusLabel}</div>
      <div style="font-size: 12px; color: #a8a195; margin-top: 2px;">
        ${hasWizard
          ? connected
            ? "Click to edit"
            : `Setup in ${c.setupTime}`
          : "In a later release"}
      </div>
    </div>
  `;
  return href
    ? html`<a href=${href} style="text-decoration: none; color: inherit; display: block;"
        >${card}</a
      >`
    : card;
}

function resolveChannelOrder(snapshot: ChannelsStatusSnapshot | null): ChannelKey[] {
  if (snapshot?.channelMeta?.length) {
    return snapshot.channelMeta.map((entry) => entry.id);
  }
  if (snapshot?.channelOrder?.length) {
    return snapshot.channelOrder;
  }
  return ["whatsapp", "telegram", "discord", "googlechat", "slack", "signal", "imessage", "nostr"];
}

function renderChannel(key: ChannelKey, props: ChannelsProps, data: ChannelsChannelData) {
  const accountCountLabel = renderChannelAccountCount(key, data.channelAccounts);
  switch (key) {
    case "whatsapp":
      return renderWhatsAppCard({
        props,
        whatsapp: data.whatsapp,
        accountCountLabel,
      });
    case "telegram":
      return renderTelegramCard({
        props,
        telegram: data.telegram,
        telegramAccounts: data.channelAccounts?.telegram ?? [],
        accountCountLabel,
      });
    case "discord":
      return renderDiscordCard({
        props,
        discord: data.discord,
        accountCountLabel,
      });
    case "googlechat":
      return renderGoogleChatCard({
        props,
        googleChat: data.googlechat,
        accountCountLabel,
      });
    case "slack":
      return renderSlackCard({
        props,
        slack: data.slack,
        accountCountLabel,
      });
    case "signal":
      return renderSignalCard({
        props,
        signal: data.signal,
        accountCountLabel,
      });
    case "imessage":
      return renderIMessageCard({
        props,
        imessage: data.imessage,
        accountCountLabel,
      });
    case "nostr": {
      const nostrAccounts = data.channelAccounts?.nostr ?? [];
      const primaryAccount = nostrAccounts[0];
      const accountId = primaryAccount?.accountId ?? "default";
      const profile =
        (primaryAccount as { profile?: NostrProfile | null } | undefined)?.profile ?? null;
      const showForm =
        props.nostrProfileAccountId === accountId ? props.nostrProfileFormState : null;
      const profileFormCallbacks = showForm
        ? {
            onFieldChange: props.onNostrProfileFieldChange,
            onSave: props.onNostrProfileSave,
            onImport: props.onNostrProfileImport,
            onCancel: props.onNostrProfileCancel,
            onToggleAdvanced: props.onNostrProfileToggleAdvanced,
          }
        : null;
      return renderNostrCard({
        props,
        nostr: data.nostr,
        nostrAccounts,
        accountCountLabel,
        profileFormState: showForm,
        profileFormCallbacks,
        onEditProfile: () => props.onNostrProfileEdit(accountId, profile),
      });
    }
    default:
      return renderGenericChannelCard(key, props, data.channelAccounts ?? {});
  }
}

function renderGenericChannelCard(
  key: ChannelKey,
  props: ChannelsProps,
  channelAccounts: Record<string, ChannelAccountSnapshot[]>,
) {
  const label = resolveChannelLabel(props.snapshot, key);
  const displayState = resolveChannelDisplayState(key, props);
  const lastError =
    typeof displayState.status?.lastError === "string" ? displayState.status.lastError : undefined;
  const accounts = channelAccounts[key] ?? [];
  const accountCountLabel = renderChannelAccountCount(key, channelAccounts);

  return html`
    <div class="card">
      <div class="card-title">${label}</div>
      <div class="card-sub">${t("channels.generic.subtitle")}</div>
      ${accountCountLabel}
      ${accounts.length > 0
        ? html`
            <div class="account-card-list">
              ${accounts.map((account) => renderGenericAccount(account))}
            </div>
          `
        : html`
            <div class="status-list" style="margin-top: 16px;">
              <div>
                <span class="label">${t("common.configured")}</span>
                <span>${formatNullableBoolean(displayState.configured)}</span>
              </div>
              <div>
                <span class="label">${t("common.running")}</span>
                <span>${formatNullableBoolean(displayState.running)}</span>
              </div>
              <div>
                <span class="label">${t("common.connected")}</span>
                <span>${formatNullableBoolean(displayState.connected)}</span>
              </div>
            </div>
          `}
      ${lastError
        ? html`<div class="callout danger" style="margin-top: 12px;">${lastError}</div>`
        : nothing}
      ${renderChannelConfigSection({ channelId: key, props })}
    </div>
  `;
}

function resolveChannelMetaMap(
  snapshot: ChannelsStatusSnapshot | null,
): Record<string, ChannelUiMetaEntry> {
  if (!snapshot?.channelMeta?.length) {
    return {};
  }
  return Object.fromEntries(snapshot.channelMeta.map((entry) => [entry.id, entry]));
}

function resolveChannelLabel(snapshot: ChannelsStatusSnapshot | null, key: string): string {
  const meta = resolveChannelMetaMap(snapshot)[key];
  return meta?.label ?? snapshot?.channelLabels?.[key] ?? key;
}

const RECENT_ACTIVITY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function hasRecentActivity(account: ChannelAccountSnapshot): boolean {
  if (!account.lastInboundAt) {
    return false;
  }
  return Date.now() - account.lastInboundAt < RECENT_ACTIVITY_THRESHOLD_MS;
}

function deriveRunningStatus(account: ChannelAccountSnapshot): string {
  if (account.running) {
    return t("common.yes");
  }
  // If we have recent inbound activity, the channel is effectively running
  if (hasRecentActivity(account)) {
    return t("common.active");
  }
  return t("common.no");
}

function deriveConnectedStatus(account: ChannelAccountSnapshot): string {
  if (account.connected === true) {
    return t("common.yes");
  }
  if (account.connected === false) {
    return t("common.no");
  }
  // If connected is null/undefined but we have recent activity, show as active
  if (hasRecentActivity(account)) {
    return t("common.active");
  }
  return t("common.na");
}

function renderGenericAccount(account: ChannelAccountSnapshot) {
  const runningStatus = deriveRunningStatus(account);
  const connectedStatus = deriveConnectedStatus(account);

  return html`
    <div class="account-card">
      <div class="account-card-header">
        <div class="account-card-title">${account.name || account.accountId}</div>
        <div class="account-card-id">${account.accountId}</div>
      </div>
      <div class="status-list account-card-status">
        <div>
          <span class="label">${t("common.running")}</span>
          <span>${runningStatus}</span>
        </div>
        <div>
          <span class="label">${t("common.configured")}</span>
          <span>${account.configured ? t("common.yes") : t("common.no")}</span>
        </div>
        <div>
          <span class="label">${t("common.connected")}</span>
          <span>${connectedStatus}</span>
        </div>
        <div>
          <span class="label">${t("common.lastInbound")}</span>
          <span
            >${account.lastInboundAt
              ? formatRelativeTimestamp(account.lastInboundAt)
              : t("common.na")}</span
          >
        </div>
        ${account.lastError
          ? html` <div class="account-card-error">${account.lastError}</div> `
          : nothing}
      </div>
    </div>
  `;
}
