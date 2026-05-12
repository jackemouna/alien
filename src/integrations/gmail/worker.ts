import type { LlmClient } from "../../orchestrator/llm-client.js";
import type { ProjectWorker, ProjectWorkerInput } from "../../projects/pickup-loop.js";
import { createGmailClient, type GmailClient } from "./client.js";
import { getGmailTokens, storeGmailTokens } from "./tokens.js";
import type { GmailMessage, GmailOAuthClientConfig } from "./types.js";

/**
 * The `email-handler` worker — what the planner dispatches to when a user
 * asks "reply to my inbox", "draft a response to the last email from
 * alice@…", etc.
 *
 * The worker accepts a structured `task.input` and routes to one of
 * three behaviors:
 *
 *   { action: "list_inbox", query?: string, maxResults?: number }
 *     → returns { messages: GmailMessage[] }
 *
 *   { action: "send",
 *     to: string, subject: string, bodyText: string,
 *     cc?: string, threadId?: string, inReplyToMessageId?: string }
 *     → returns { sent: SentEmailReceipt }
 *
 *   { action: "draft_reply",
 *     inReplyToMessageId: string,
 *     // EITHER bodyText (literal) OR replyPrompt (let the LLM draft from the original)
 *     bodyText?: string,
 *     replyPrompt?: string }
 *     → returns { draft: DraftReceipt, bodyText: string }
 *
 * Sending and "draft_reply with literal bodyText" are *destructive enough*
 * that the planner is encouraged (via the system prompt) to mark them
 * `requiresApproval: true` so the human approves before the worker fires.
 *
 * The worker is stateless across invocations; tokens come from the OS
 * keychain on every call (the client refreshes in-memory and writes back
 * to the keychain when needed).
 */

export type CreateEmailHandlerWorkerParams = {
  readonly oauthConfig: GmailOAuthClientConfig;
  readonly defaultEmail: string;
  /** LLM for drafting replies when the operator asks for "draft a reply". */
  readonly llm?: LlmClient;
  /** Override the Gmail client (tests inject a stub). */
  readonly clientFactory?: (account: string) => Promise<GmailClient>;
  readonly now?: () => number;
};

export type EmailHandlerInput =
  | { readonly action: "list_inbox"; readonly query?: string; readonly maxResults?: number }
  | {
      readonly action: "send";
      readonly to: string;
      readonly subject: string;
      readonly bodyText: string;
      readonly cc?: string;
      readonly threadId?: string;
      readonly inReplyToMessageId?: string;
    }
  | {
      readonly action: "draft_reply";
      readonly inReplyToMessageId: string;
      readonly bodyText?: string;
      readonly replyPrompt?: string;
    };

export function createEmailHandlerWorker(params: CreateEmailHandlerWorkerParams): ProjectWorker {
  return async (input: ProjectWorkerInput) => {
    const action = parseAction(input.task.input);
    if (!action) {
      return {
        ok: false,
        error:
          "email-handler: unrecognized action. Use action='list_inbox' | 'send' | 'draft_reply'.",
      };
    }
    const account = readAccount(input.task.input) ?? params.defaultEmail;
    let client: GmailClient;
    try {
      client = await (params.clientFactory ?? defaultClientFactory(params))(account);
    } catch (err) {
      return { ok: false, error: stringifyError(err) };
    }

    try {
      if (action.action === "list_inbox") {
        const messages = await client.listInbox({
          ...(action.query ? { query: action.query } : {}),
          ...(action.maxResults ? { maxResults: action.maxResults } : {}),
        });
        return { ok: true, result: { messages: messages.map(stripMessageForOutput) } };
      }
      if (action.action === "send") {
        const sent = await client.sendEmail({
          to: action.to,
          subject: action.subject,
          bodyText: action.bodyText,
          ...(action.cc ? { cc: action.cc } : {}),
          ...(action.threadId ? { threadId: action.threadId } : {}),
          ...(action.inReplyToMessageId ? { inReplyToMessageId: action.inReplyToMessageId } : {}),
        });
        return { ok: true, result: { sent } };
      }
      // draft_reply
      const bodyText = await resolveDraftBody(action, client, params.llm);
      if (!bodyText) {
        return {
          ok: false,
          error:
            "email-handler: draft_reply needs either bodyText or replyPrompt (with an LLM client configured).",
        };
      }
      const draft = await client.createDraft({
        inReplyToMessageId: action.inReplyToMessageId,
        bodyText,
      });
      return { ok: true, result: { draft, bodyText }, toReview: true };
    } catch (err) {
      return { ok: false, error: stringifyError(err) };
    }
  };
}

async function resolveDraftBody(
  action: Extract<EmailHandlerInput, { action: "draft_reply" }>,
  client: GmailClient,
  llm: LlmClient | undefined,
): Promise<string | null> {
  if (action.bodyText && action.bodyText.trim()) {
    return action.bodyText;
  }
  if (!action.replyPrompt || !llm) {
    return null;
  }
  const original = await client.getMessage(action.inReplyToMessageId);
  const draft = await llm.complete({
    system:
      "You are an email assistant. Draft a polite, concise reply to the supplied email. " +
      "Match the original's tone. Do not include a signature unless asked. Plain text only.",
    user: `Original email:\nFrom: ${original.from ?? "unknown"}\nSubject: ${original.subject ?? "(no subject)"}\n\n${original.bodyText || original.snippet}\n\nUser instruction for the reply:\n${action.replyPrompt}`,
    purpose: "email-handler.draft_reply",
    maxTokens: 600,
  });
  return draft.trim();
}

function parseAction(input: Record<string, unknown>): EmailHandlerInput | null {
  const action = typeof input.action === "string" ? input.action : "";
  if (action === "list_inbox") {
    return {
      action: "list_inbox",
      ...(typeof input.query === "string" ? { query: input.query } : {}),
      ...(typeof input.maxResults === "number" && Number.isFinite(input.maxResults)
        ? { maxResults: input.maxResults }
        : {}),
    };
  }
  if (action === "send") {
    if (typeof input.to !== "string" || !input.to.trim()) return null;
    if (typeof input.subject !== "string") return null;
    if (typeof input.bodyText !== "string") return null;
    return {
      action: "send",
      to: input.to,
      subject: input.subject,
      bodyText: input.bodyText,
      ...(typeof input.cc === "string" && input.cc.trim() ? { cc: input.cc } : {}),
      ...(typeof input.threadId === "string" && input.threadId ? { threadId: input.threadId } : {}),
      ...(typeof input.inReplyToMessageId === "string" && input.inReplyToMessageId
        ? { inReplyToMessageId: input.inReplyToMessageId }
        : {}),
    };
  }
  if (action === "draft_reply") {
    if (typeof input.inReplyToMessageId !== "string" || !input.inReplyToMessageId) {
      return null;
    }
    return {
      action: "draft_reply",
      inReplyToMessageId: input.inReplyToMessageId,
      ...(typeof input.bodyText === "string" ? { bodyText: input.bodyText } : {}),
      ...(typeof input.replyPrompt === "string" ? { replyPrompt: input.replyPrompt } : {}),
    };
  }
  return null;
}

function readAccount(input: Record<string, unknown>): string | undefined {
  return typeof input.account === "string" && input.account.trim() ? input.account : undefined;
}

function defaultClientFactory(
  params: CreateEmailHandlerWorkerParams,
): (account: string) => Promise<GmailClient> {
  return async (account: string) => {
    const tokens = getGmailTokens({ email: account });
    if (!tokens) {
      throw new Error(
        `email-handler: no tokens for ${account}. Run 'alien gmail connect' to authorize.`,
      );
    }
    return createGmailClient({
      oauthConfig: params.oauthConfig,
      initialTokens: tokens,
      ...(params.now ? { now: params.now } : {}),
      onTokensRefreshed: (next) => {
        storeGmailTokens({ email: account, tokens: next });
      },
    });
  };
}

function stripMessageForOutput(msg: GmailMessage): Record<string, unknown> {
  // The worker output ends up in the audit log + the chat reply path. Trim
  // large bodies to a snippet by default; the planner can re-fetch with a
  // specific id when it needs the full text.
  return {
    id: msg.id,
    threadId: msg.threadId,
    ...(msg.from ? { from: msg.from } : {}),
    ...(msg.subject ? { subject: msg.subject } : {}),
    ...(msg.date ? { date: msg.date } : {}),
    snippet: msg.snippet,
    unread: msg.unread,
    bodyExcerpt: msg.bodyText.slice(0, 1200),
  };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
