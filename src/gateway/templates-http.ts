import type { IncomingMessage, ServerResponse } from "node:http";
import { loadStarterTemplates } from "../templates/loader.js";
import type { StarterTemplate } from "../templates/types.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { sendJson } from "./http-common.js";
import {
  authorizeGatewayHttpRequestOrReply,
  resolveOpenAiCompatibleHttpOperatorScopes,
} from "./http-utils.js";
import { authorizeOperatorScopesForMethod } from "./method-scopes.js";

/**
 * Read-only `/v1/templates` route. Backs the Templates gallery in
 * ui/src/ui/views/projects.ts (rendered in the first-run empty state).
 *
 * Templates are pure data shipped with the repo; the route doesn't take
 * any inputs and just returns the loaded list. Auth treatment matches
 * the other read endpoints — bearer token counts as full operator scope.
 */

export type TemplatesHttpOptions = {
  readonly auth: ResolvedGatewayAuth;
  readonly trustedProxies?: readonly string[];
  readonly allowRealIpFallback?: boolean;
  readonly rateLimiter?: AuthRateLimiter;
};

export function isTemplatesPath(pathname: string): boolean {
  return pathname === "/v1/templates";
}

export async function handleTemplatesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: TemplatesHttpOptions,
): Promise<boolean> {
  if (req.method !== "GET") return false;
  const requestAuth = await authorizeGatewayHttpRequestOrReply({
    req,
    res,
    auth: opts.auth,
    ...(opts.trustedProxies ? { trustedProxies: [...opts.trustedProxies] } : {}),
    ...(opts.allowRealIpFallback !== undefined
      ? { allowRealIpFallback: opts.allowRealIpFallback }
      : {}),
    ...(opts.rateLimiter ? { rateLimiter: opts.rateLimiter } : {}),
  });
  if (!requestAuth) return true;
  const requestedScopes = resolveOpenAiCompatibleHttpOperatorScopes(req, requestAuth);
  const scopeAuth = authorizeOperatorScopesForMethod("chat.send", requestedScopes);
  if (!scopeAuth.allowed) {
    sendJson(res, 403, {
      ok: false,
      error: { type: "forbidden", message: `missing scope: ${scopeAuth.missingScope}` },
    });
    return true;
  }
  const templates: readonly StarterTemplate[] = loadStarterTemplates();
  sendJson(res, 200, { templates });
  return true;
}
