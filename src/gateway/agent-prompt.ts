import { randomBytes } from "node:crypto";
import { buildHistoryContextFromEntries, type HistoryEntry } from "../auto-reply/reply/history.js";
import { extractTextFromChatContent } from "../shared/chat-content.js";

export type ConversationEntry = {
  role: "user" | "assistant" | "tool";
  entry: HistoryEntry;
};

/**
 * Coerce body to string. Handles cases where body is a content array
 * (e.g. [{type:"text", text:"hello"}]) that would serialize as
 * [object Object] if used directly in a template literal.
 */
function safeBody(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  return extractTextFromChatContent(body) ?? "";
}

const FENCE_TAG = "msg_body";
const FENCE_OPEN_RE = /<\s*msg_body\b[^>]*>/gi;
const FENCE_CLOSE_RE = /<\s*\/\s*msg_body\s*>/gi;

/**
 * Audit H4: structural fence for inbound untrusted message bodies.
 *
 * When entries originate from an untrusted source (HTTP-API messages whose
 * content is provided by an external caller, channel DMs, …), wrap each body
 * with `<msg_body id="<rand>">…</msg_body>` markers so the model can
 * structurally distinguish "message text" from operator instructions or
 * system context. The marker id is randomized per call to defeat naive
 * spoofing where a body claims to close a previously-opened fence.
 *
 * Any literal `<msg_body…>` or `</msg_body>` sequences inside the body itself
 * are sanitized so they cannot escape the fence.
 *
 * The wrapping is opt-in via the `untrusted: true` flag. Operator-driven
 * paths leave it false to keep the prompt clean and avoid burning tokens on
 * benign messages.
 */
function fenceBody(body: string): string {
  const id = randomBytes(4).toString("hex");
  const sanitized = body
    .replace(FENCE_OPEN_RE, "[msg_body]")
    .replace(FENCE_CLOSE_RE, "[/msg_body]");
  return `<${FENCE_TAG} id="${id}">${sanitized}</${FENCE_TAG}>`;
}

export type BuildAgentMessageOptions = {
  /**
   * When true, each entry body is wrapped in a randomized
   * `<msg_body id="…">…</msg_body>` fence (audit H4). Default: false.
   */
  readonly untrusted?: boolean;
};

export function buildAgentMessageFromConversationEntries(
  entries: ConversationEntry[],
  options: BuildAgentMessageOptions = {},
): string {
  if (entries.length === 0) {
    return "";
  }

  // Prefer the last user/tool entry as "current message" so the agent responds to
  // the latest user input or tool output, not the assistant's previous message.
  let currentIndex = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const role = entries[i]?.role;
    if (role === "user" || role === "tool") {
      currentIndex = i;
      break;
    }
  }
  if (currentIndex < 0) {
    currentIndex = entries.length - 1;
  }

  const currentEntry = entries[currentIndex]?.entry;
  if (!currentEntry) {
    return "";
  }

  const renderBody = options.untrusted
    ? (entry: HistoryEntry) => fenceBody(safeBody(entry.body))
    : (entry: HistoryEntry) => safeBody(entry.body);

  const historyEntries = entries.slice(0, currentIndex).map((e) => e.entry);
  if (historyEntries.length === 0) {
    return renderBody(currentEntry);
  }

  const formatEntry = (entry: HistoryEntry) => `${entry.sender}: ${renderBody(entry)}`;
  return buildHistoryContextFromEntries({
    entries: [...historyEntries, currentEntry],
    currentMessage: formatEntry(currentEntry),
    formatEntry,
  });
}
