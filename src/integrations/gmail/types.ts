/**
 * Gmail integration types. Narrow surface: list inbox, get a single
 * message, send a new email, draft a reply. v0.2+ will add: search by
 * label, attachments, threads view, batch send.
 *
 * Tokens land in the OS keychain via src/security/os-keychain.ts so they
 * never persist in plaintext on disk. Two distinct accounts (`alice@…`
 * and `bob@…`) can be configured side-by-side under separate keychain
 * accounts.
 */

export type GmailOAuthClientConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Where Google sends the user back. Must match the OAuth client config. */
  readonly redirectUri: string;
};

export type GmailTokens = {
  readonly accessToken: string;
  /** Long-lived refresh token. Required for the worker to keep working. */
  readonly refreshToken: string;
  /** Epoch ms when accessToken expires. */
  readonly expiresAt: number;
  /** Granted scopes (Google's `scope` response, space-separated). */
  readonly scopes: readonly string[];
};

export type StoredGmailAccount = {
  readonly email: string;
  readonly tokens: GmailTokens;
};

export type GmailMessage = {
  readonly id: string;
  readonly threadId: string;
  readonly from?: string;
  readonly to?: string;
  readonly subject?: string;
  /** ISO-8601 timestamp parsed from the message headers. */
  readonly date?: string;
  readonly snippet: string;
  /** Plain-text body when the worker decoded it; "" if only HTML is available. */
  readonly bodyText: string;
  /** Whether the user has not opened this message yet. */
  readonly unread: boolean;
  readonly labels: readonly string[];
};

export type ListInboxOptions = {
  /** Gmail search query (e.g. "is:unread newer_than:1d"). */
  readonly query?: string;
  /** Page size; Gmail's max is 500 but the worker should keep it small. */
  readonly maxResults?: number;
};

export type SendEmailDraft = {
  readonly to: string;
  /** Optional CC list (comma-separated). */
  readonly cc?: string;
  readonly subject: string;
  readonly bodyText: string;
  /**
   * When the email is a reply to an existing thread, the message id whose
   * Message-Id header we should reference (Gmail uses In-Reply-To +
   * References headers for proper threading).
   */
  readonly inReplyToMessageId?: string;
  /** Thread id to attach the reply to, so Gmail groups them together. */
  readonly threadId?: string;
};

export type SentEmailReceipt = {
  readonly id: string;
  readonly threadId: string;
};

export type DraftReplyOptions = {
  readonly inReplyToMessageId: string;
  readonly bodyText: string;
};

export type DraftReceipt = {
  readonly draftId: string;
  readonly messageId: string;
  readonly threadId: string;
};

/**
 * The Gmail scopes Alien requests. Narrow on purpose:
 *   - `gmail.readonly`  — list + read messages
 *   - `gmail.send`      — send new emails and replies
 *   - `gmail.compose`   — create drafts (less destructive than send)
 *
 * We deliberately do NOT request `gmail.modify` (delete/label changes)
 * or `mail.google.com` (full mailbox) for v0.1. Users can audit the
 * grant at https://myaccount.google.com/permissions.
 */
export const GMAIL_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
] as const;
