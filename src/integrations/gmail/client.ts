import { refreshAccessToken } from "./oauth.js";
import type {
  DraftReceipt,
  DraftReplyOptions,
  GmailMessage,
  GmailOAuthClientConfig,
  GmailTokens,
  ListInboxOptions,
  SendEmailDraft,
  SentEmailReceipt,
} from "./types.js";

/**
 * Minimal Gmail API client — list inbox, fetch message body, send mail,
 * draft reply. Designed to be trivially testable via injected `fetchImpl`
 * and `now`. Token refresh is automatic on 401 and on time-based expiry
 * (with a 60-second skew buffer).
 *
 * v0.2+ will add: attachments, search filters, batch send, labels.
 */

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

const TOKEN_REFRESH_SKEW_MS = 60_000;

export type CreateGmailClientParams = {
  readonly oauthConfig: GmailOAuthClientConfig;
  readonly initialTokens: GmailTokens;
  /** Called whenever the client refreshes the access token; persist these. */
  readonly onTokensRefreshed?: (next: GmailTokens) => void | Promise<void>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
};

export type GmailClient = {
  readonly listInbox: (options?: ListInboxOptions) => Promise<readonly GmailMessage[]>;
  readonly getMessage: (id: string) => Promise<GmailMessage>;
  readonly sendEmail: (draft: SendEmailDraft) => Promise<SentEmailReceipt>;
  readonly createDraft: (options: DraftReplyOptions) => Promise<DraftReceipt>;
  /** Current tokens (after any auto-refresh). Exposed for callers that need to persist. */
  readonly currentTokens: () => GmailTokens;
};

export function createGmailClient(params: CreateGmailClientParams): GmailClient {
  const fetchFn = params.fetchImpl ?? fetch;
  const now = params.now ?? Date.now;
  let tokens = params.initialTokens;

  async function ensureFreshToken(): Promise<void> {
    if (tokens.expiresAt - TOKEN_REFRESH_SKEW_MS > now()) return;
    const next = await refreshAccessToken({
      config: params.oauthConfig,
      refreshToken: tokens.refreshToken,
      fetchImpl: fetchFn,
      now,
    });
    tokens = next;
    await params.onTokensRefreshed?.(next);
  }

  async function authedFetch(
    url: string,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<Response> {
    await ensureFreshToken();
    const { json, ...rest } = init;
    const headers = new Headers(rest.headers ?? {});
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    let body = rest.body;
    if (json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(json);
    }
    let res = await fetchFn(url, { ...rest, headers, body });
    if (res.status === 401) {
      // Force a refresh path even if our clock thought the token was fresh.
      tokens = { ...tokens, expiresAt: 0 };
      await ensureFreshToken();
      headers.set("Authorization", `Bearer ${tokens.accessToken}`);
      res = await fetchFn(url, { ...rest, headers, body });
    }
    return res;
  }

  return {
    async listInbox(options) {
      const params2 = new URLSearchParams();
      if (options?.query) params2.set("q", options.query);
      params2.set("maxResults", String(Math.max(1, Math.min(50, options?.maxResults ?? 10))));
      const listRes = await authedFetch(`${GMAIL_API_BASE}/messages?${params2.toString()}`);
      if (!listRes.ok) throw await apiError(listRes, "listInbox");
      const list = (await listRes.json()) as { messages?: Array<{ id: string }> };
      const messages = list.messages ?? [];
      const out: GmailMessage[] = [];
      for (const ref of messages) {
        const full = await authedFetch(
          `${GMAIL_API_BASE}/messages/${encodeURIComponent(ref.id)}?format=full`,
        );
        if (!full.ok) throw await apiError(full, "getMessage");
        out.push(parseGmailMessage((await full.json()) as RawGmailMessage));
      }
      return out;
    },

    async getMessage(id) {
      const res = await authedFetch(
        `${GMAIL_API_BASE}/messages/${encodeURIComponent(id)}?format=full`,
      );
      if (!res.ok) throw await apiError(res, "getMessage");
      return parseGmailMessage((await res.json()) as RawGmailMessage);
    },

    async sendEmail(draft) {
      const rfc822 = buildRfc822(draft);
      const res = await authedFetch(`${GMAIL_API_BASE}/messages/send`, {
        method: "POST",
        json: {
          raw: toBase64Url(rfc822),
          ...(draft.threadId ? { threadId: draft.threadId } : {}),
        },
      });
      if (!res.ok) throw await apiError(res, "sendEmail");
      const json = (await res.json()) as { id: string; threadId: string };
      return { id: json.id, threadId: json.threadId };
    },

    async createDraft(options) {
      // Fetch the message first so we can carry Subject / To / threadId / headers.
      const original = await (async () => {
        const res = await authedFetch(
          `${GMAIL_API_BASE}/messages/${encodeURIComponent(options.inReplyToMessageId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Message-ID&metadataHeaders=References`,
        );
        if (!res.ok) throw await apiError(res, "createDraft.fetchOriginal");
        return (await res.json()) as RawGmailMessage;
      })();
      const headers = headersToMap(original.payload?.headers ?? []);
      const subject = headers.get("subject") ?? "(no subject)";
      const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
      const to = headers.get("from") ?? "";
      const inReplyTo = headers.get("message-id") ?? "";
      const references = headers.get("references")
        ? `${headers.get("references")} ${inReplyTo}`.trim()
        : inReplyTo;
      const rfc822 = buildRfc822(
        {
          to,
          subject: replySubject,
          bodyText: options.bodyText,
          inReplyToMessageId: inReplyTo,
          threadId: original.threadId,
        },
        { references },
      );
      const res = await authedFetch(`${GMAIL_API_BASE}/drafts`, {
        method: "POST",
        json: {
          message: {
            raw: toBase64Url(rfc822),
            threadId: original.threadId,
          },
        },
      });
      if (!res.ok) throw await apiError(res, "createDraft");
      const json = (await res.json()) as { id: string; message?: { id: string; threadId: string } };
      return {
        draftId: json.id,
        messageId: json.message?.id ?? "",
        threadId: json.message?.threadId ?? original.threadId,
      };
    },

    currentTokens: () => tokens,
  };
}

// --- Gmail message parsing ----------------------------------------------------

type RawGmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  payload?: RawGmailPayload;
  internalDate?: string;
};

type RawGmailPayload = {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; size?: number };
  parts?: RawGmailPayload[];
};

function parseGmailMessage(raw: RawGmailMessage): GmailMessage {
  const headers = headersToMap(raw.payload?.headers ?? []);
  const labels = raw.labelIds ?? [];
  const bodyText = extractTextBody(raw.payload);
  return {
    id: raw.id,
    threadId: raw.threadId,
    snippet: raw.snippet ?? "",
    bodyText,
    unread: labels.includes("UNREAD"),
    labels: [...labels],
    ...(headers.get("from") ? { from: headers.get("from")! } : {}),
    ...(headers.get("to") ? { to: headers.get("to")! } : {}),
    ...(headers.get("subject") ? { subject: headers.get("subject")! } : {}),
    ...(headers.get("date")
      ? { date: parseDate(headers.get("date")!) ?? headers.get("date")! }
      : {}),
  };
}

function headersToMap(
  headers: ReadonlyArray<{ name?: string; value?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    if (h.name && h.value !== undefined) {
      map.set(h.name.toLowerCase(), h.value);
    }
  }
  return map;
}

function extractTextBody(payload: RawGmailPayload | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return fromBase64Url(payload.body.data);
  }
  if (payload.parts && payload.parts.length > 0) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) {
      return fromBase64Url(plain.body.data);
    }
    for (const part of payload.parts) {
      const nested = extractTextBody(part);
      if (nested) return nested;
    }
  }
  return "";
}

function parseDate(value: string): string | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

// --- RFC 822 message construction --------------------------------------------

function buildRfc822(draft: SendEmailDraft, extras: { readonly references?: string } = {}): string {
  const headers: string[] = [];
  headers.push(`To: ${draft.to}`);
  if (draft.cc) headers.push(`Cc: ${draft.cc}`);
  headers.push(`Subject: ${draft.subject}`);
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: 7bit");
  if (draft.inReplyToMessageId) {
    headers.push(`In-Reply-To: ${draft.inReplyToMessageId}`);
    headers.push(`References: ${extras.references ?? draft.inReplyToMessageId}`);
  }
  return `${headers.join("\r\n")}\r\n\r\n${draft.bodyText}`;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

async function apiError(res: Response, op: string): Promise<Error> {
  let detail: string;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? `HTTP ${res.status}`;
  } catch {
    detail = `HTTP ${res.status}`;
  }
  return new Error(`Gmail ${op} failed: ${detail}`);
}
