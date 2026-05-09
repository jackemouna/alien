import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Audit M3: per-async-context origin marker for tool-call invocations.
 *
 * The audit's concern is that post-incident logs cannot answer "did the
 * agent run this tool because I asked, or because a DM/webpage said to?".
 * Without an origin marker, every tool call looks identical regardless of
 * what triggered the model decision.
 *
 * This module holds the origin in an AsyncLocalStorage so any code reached
 * through the request handler can tag log entries with the current source
 * without having to thread an extra parameter through every call site.
 *
 * The integration is incremental: gateway entry points set the origin once
 * when a request lands; audit-log writes pull `currentOrigin()` at append
 * time. Code paths that have not yet been instrumented continue to write
 * `origin: "unknown"`, which is still a useful signal in the log.
 *
 * Origin shape is open-ended on purpose — channels can use `channel:slack`,
 * `channel:discord`, etc., the HTTP-API can use `http:openai-completions`,
 * and the operator CLI/TUI uses `operator`.
 */

export type OriginContext = {
  /** Short label, e.g. `"operator"`, `"http:openai-completions"`, `"channel:slack"`. */
  readonly source: string;
  /** Whether the source is untrusted (anything that came from outside the operator). */
  readonly untrusted: boolean;
  /** Free-form details for the audit log (sender id, channel id, request id, …). */
  readonly details?: Readonly<Record<string, string>>;
};

const storage = new AsyncLocalStorage<OriginContext>();

const UNKNOWN_ORIGIN: OriginContext = Object.freeze({
  source: "unknown",
  untrusted: false,
});

/**
 * Returns the origin recorded for the current async context, or a frozen
 * `unknown` sentinel when no caller has set one.
 */
export function currentOrigin(): OriginContext {
  return storage.getStore() ?? UNKNOWN_ORIGIN;
}

/**
 * Runs `fn` with `origin` set as the current async-context origin. The
 * origin is visible to every awaited descendant; siblings outside the
 * `fn` lambda see whatever origin was active before this call.
 */
export function runWithOrigin<T>(origin: OriginContext, fn: () => T): T {
  return storage.run(origin, fn);
}

/**
 * Convenience for code paths that already know the origin label and just
 * want to mark it as trusted operator input.
 */
export function runAsOperator<T>(fn: () => T, details?: Record<string, string>): T {
  return runWithOrigin(
    { source: "operator", untrusted: false, ...(details ? { details } : {}) },
    fn,
  );
}

/**
 * Convenience for inbound channel handlers. `kind` ends up as
 * `channel:<kind>` so logs can filter by channel.
 */
export function runAsChannel<T>(kind: string, details: Record<string, string>, fn: () => T): T {
  return runWithOrigin({ source: `channel:${kind}`, untrusted: true, details }, fn);
}

/**
 * Convenience for inbound HTTP-API handlers (openai-http,
 * openresponses-prompt, …).
 */
export function runAsHttp<T>(endpoint: string, details: Record<string, string>, fn: () => T): T {
  return runWithOrigin({ source: `http:${endpoint}`, untrusted: true, details }, fn);
}
