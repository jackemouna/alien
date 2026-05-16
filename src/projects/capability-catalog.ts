/**
 * Catalog of the capabilities the planner can reach for. Used in two
 * places:
 *
 *   1. The planner's system prompt — so the model knows what worker roles
 *      and integrations exist and emits a `capability-broker` task when
 *      it needs something missing.
 *   2. The capability broker — so a request can be quickly rejected as
 *      "this already exists, use X" instead of being recorded as a new
 *      gap.
 *
 * v0.1 is intentionally static — Phase D will swap this for a
 * registry-driven discovery once self-coded extensions can register
 * their own capabilities at runtime.
 */

import type { WorkerRole } from "../orchestrator/types.js";

export type CapabilityKind = "worker" | "channel" | "integration";

export type CapabilityEntry = {
  readonly id: string;
  readonly kind: CapabilityKind;
  /** What the agent can do with this capability — used in the planner prompt. */
  readonly summary: string;
  /** Worker role to invoke when this is a "worker" capability. */
  readonly role?: WorkerRole;
};

export const CAPABILITY_CATALOG: ReadonlyArray<CapabilityEntry> = [
  {
    id: "researcher",
    kind: "worker",
    role: "researcher",
    summary: "Gather facts and evidence about a topic from prior knowledge.",
  },
  {
    id: "writer",
    kind: "worker",
    role: "writer",
    summary: "Produce a draft document from research and inputs.",
  },
  {
    id: "editor",
    kind: "worker",
    role: "editor",
    summary: "Revise drafts for quality, structure, and consistency.",
  },
  {
    id: "publisher",
    kind: "worker",
    role: "publisher",
    summary: "Persist the final artifact (file, channel post, etc.).",
  },
  {
    id: "email-handler",
    kind: "worker",
    role: "email-handler",
    summary: "Read Gmail inbox, draft replies, send mail.",
  },
  {
    id: "channel:telegram",
    kind: "channel",
    summary: "Send and receive Telegram messages once wired via /setup/channels/telegram.",
  },
  {
    id: "channel:discord",
    kind: "channel",
    summary: "Send and receive Discord messages once wired via /setup/channels/discord.",
  },
  {
    id: "channel:slack",
    kind: "channel",
    summary: "Send and receive Slack messages once wired via /setup/channels/slack.",
  },
  {
    id: "channel:whatsapp",
    kind: "channel",
    summary: "Send and receive WhatsApp messages once paired via QR.",
  },
  {
    id: "channel:imessage",
    kind: "channel",
    summary: "macOS-native iMessage send/receive once Full Disk Access is granted.",
  },
];

export function findCapability(id: string): CapabilityEntry | undefined {
  return CAPABILITY_CATALOG.find((entry) => entry.id === id);
}

/**
 * Live capabilities (self-coded + activated + loaded at runtime). The
 * planner sees these alongside the static catalog and can dispatch to
 * them via a capability-runner task. The renderer accepts an optional
 * list so the gateway can pass its current loader snapshot without the
 * catalog module depending on the loader directly.
 */
export type LiveCapability = {
  readonly id: string;
  /** Free-form summary the operator (or self-coder README) provided. */
  readonly summary: string;
};

/**
 * One-line per capability, suitable for inlining into the planner prompt.
 */
export function renderCatalogForPlanner(live: ReadonlyArray<LiveCapability> = []): string {
  const baseLines = CAPABILITY_CATALOG.map(
    (entry) => `- ${entry.id} (${entry.kind}): ${entry.summary}`,
  );
  if (live.length === 0) return baseLines.join("\n");
  const liveLines = live.map(
    (entry) => `- live:${entry.id} (activated, dispatch via capability-runner): ${entry.summary}`,
  );
  return [...baseLines, ...liveLines].join("\n");
}
