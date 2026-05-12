import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../shared/listeners.js";

/**
 * Cross-channel "inbound message received" hook surface.
 *
 * Core emits `emitChannelInbound()` exactly once per inbound message that
 * reaches `dispatchInboundMessage()` in `src/auto-reply/dispatch.ts`. Any
 * subsystem (project inbox router, future workflow triggers, custom audit
 * hooks) can subscribe via `onChannelInbound(listener)` and observe the
 * structured event without coupling to the auto-reply / agent loop.
 *
 * Channel plugins (extensions/slack, extensions/discord, …) do *not* need to
 * be modified — they already call into core's `dispatchInboundMessage`, and
 * the emit lives there. Listeners are *observers*, not interceptors; they do
 * not block or short-circuit the auto-reply dispatch.
 */

export type ChannelInboundEvent = {
  /** Channel plugin id ("slack", "discord", "telegram", …). */
  readonly channel: string;
  /** Per-channel account or workspace id. */
  readonly accountId?: string;
  /** Sender id (Slack user id, Discord user id, …). */
  readonly from?: string;
  /** Human-readable sender label (for audit logs / planner context). */
  readonly fromDisplayName?: string;
  /** Conversation id (DM id, channel id, room id). */
  readonly to?: string;
  /** Thread / reply-chain id (Slack `thread_ts`, Discord parent message). */
  readonly threadId?: string;
  /** Message text the user sent. */
  readonly text: string;
  /** Provider-assigned message id. */
  readonly messageId?: string;
  /** When core received the inbound. */
  readonly ts: number;
};

type State = {
  listeners: Set<(evt: ChannelInboundEvent) => void>;
};

const KEY = Symbol.for("alien.plugin-sdk.channel-inbound-listener.state");

const state = resolveGlobalSingleton<State>(KEY, () => ({
  listeners: new Set<(evt: ChannelInboundEvent) => void>(),
}));

export function emitChannelInbound(evt: Omit<ChannelInboundEvent, "ts">): void {
  notifyListeners(state.listeners, { ts: Date.now(), ...evt });
}

export function onChannelInbound(listener: (evt: ChannelInboundEvent) => void): () => void {
  return registerListener(state.listeners, listener);
}

export function resetChannelInboundListenersForTest(): void {
  state.listeners.clear();
}
