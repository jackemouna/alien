// Private runtime barrel for the bundled Twitch extension.
// Keep this barrel thin and aligned with the local extension surface.

export type {
  ChannelAccountSnapshot,
  ChannelCapabilities,
  ChannelGatewayContext,
  ChannelLogSink,
  ChannelMessageActionAdapter,
  ChannelMessageActionContext,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelOutboundContext,
  ChannelResolveKind,
  ChannelResolveResult,
  ChannelStatusAdapter,
} from "alien/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "alien/plugin-sdk/channel-core";
export type { OutboundDeliveryResult } from "alien/plugin-sdk/channel-send-result";
export type { AlienConfig } from "alien/plugin-sdk/config-types";
export type { RuntimeEnv } from "alien/plugin-sdk/runtime";
export type { WizardPrompter } from "alien/plugin-sdk/setup";
