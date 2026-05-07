import { formatTrimmedAllowFromEntries } from "alien/plugin-sdk/channel-config-helpers";
import { PAIRING_APPROVED_MESSAGE } from "alien/plugin-sdk/channel-status";
import {
  DEFAULT_ACCOUNT_ID,
  getChatChannelMeta,
  type ChannelPlugin,
} from "alien/plugin-sdk/core";
import { resolveChannelMediaMaxBytes } from "alien/plugin-sdk/media-runtime";
import { collectStatusIssuesFromLastError } from "alien/plugin-sdk/status-helpers";
import { normalizeIMessageMessagingTarget } from "./normalize.js";
export { chunkTextForOutbound } from "alien/plugin-sdk/text-chunking";

export {
  collectStatusIssuesFromLastError,
  DEFAULT_ACCOUNT_ID,
  formatTrimmedAllowFromEntries,
  getChatChannelMeta,
  normalizeIMessageMessagingTarget,
  PAIRING_APPROVED_MESSAGE,
  resolveChannelMediaMaxBytes,
};

export type { ChannelPlugin };
