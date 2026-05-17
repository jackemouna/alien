import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { TlsOptions } from "node:tls";
import type { WebSocketServer } from "ws";
import {
  A2UI_PATH,
  CANVAS_HOST_PATH,
  CANVAS_WS_PATH,
  handleA2uiHttpRequest,
} from "../canvas-host/a2ui.js";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import { resolveBundledChannelGatewayAuthBypassPaths } from "../channels/plugins/gateway-auth-bypass.js";
import { getRuntimeConfig } from "../config/io.js";
import type { AlienConfig } from "../config/types.alien.js";
import {
  createDiagnosticTraceContext,
  runWithDiagnosticTraceContext,
} from "../infra/diagnostic-trace-context.js";
import { resolveAssistantIdentity } from "./assistant-identity.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import {
  authorizeHttpGatewayConnect,
  isLocalDirectRequest,
  type GatewayAuthResult,
  type ResolvedGatewayAuth,
} from "./auth.js";
import { normalizeCanvasScopedUrl } from "./canvas-capability.js";
import type { ControlUiRootState } from "./control-ui.js";
import type { AuthorizedGatewayHttpRequest } from "./http-auth-utils.js";
import { sendGatewayAuthFailure, setDefaultSecurityHeaders } from "./http-common.js";
import { resolveRequestClientIp } from "./net.js";
import type { HooksRequestHandler } from "./server/hooks-request-handler.js";
import {
  isProtectedPluginRoutePathFromContext,
  resolvePluginRoutePathContext,
  type PluginRoutePathContext,
} from "./server/plugins-http/path-context.js";
import type { PreauthConnectionBudget } from "./server/preauth-connection-budget.js";
import type { ReadinessChecker } from "./server/readiness.js";
import type { GatewayWsClient } from "./server/ws-types.js";

type PluginHttpRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  pathContext?: PluginRoutePathContext,
  dispatchContext?: {
    gatewayAuthSatisfied?: boolean;
    gatewayRequestAuth?: AuthorizedGatewayHttpRequest;
    gatewayRequestOperatorScopes?: readonly string[];
  },
) => Promise<boolean>;

let identityAvatarModulePromise: Promise<typeof import("../agents/identity-avatar.js")> | undefined;
let controlUiModulePromise: Promise<typeof import("./control-ui.js")> | undefined;
let embeddingsHttpModulePromise: Promise<typeof import("./embeddings-http.js")> | undefined;
let managedImageAttachmentsModulePromise:
  | Promise<typeof import("./managed-image-attachments.js")>
  | undefined;
let modelsHttpModulePromise: Promise<typeof import("./models-http.js")> | undefined;
let openAiHttpModulePromise: Promise<typeof import("./openai-http.js")> | undefined;
let openResponsesHttpModulePromise: Promise<typeof import("./openresponses-http.js")> | undefined;
let orchestratorHttpModulePromise: Promise<typeof import("./orchestrator-http.js")> | undefined;
let projectsHttpModulePromise: Promise<typeof import("./projects-http.js")> | undefined;
let setupHttpModulePromise: Promise<typeof import("./setup-http.js")> | undefined;
let channelsWizardModulePromise: Promise<typeof import("./channels-wizard.js")> | undefined;
let capabilitiesHttpModulePromise: Promise<typeof import("./capabilities-http.js")> | undefined;
let capabilitiesUiModulePromise: Promise<typeof import("./capabilities-ui.js")> | undefined;
let activityStreamModulePromise: Promise<typeof import("./activity-stream-http.js")> | undefined;
let activityUiModulePromise: Promise<typeof import("./activity-ui.js")> | undefined;
let modelSwitcherModulePromise: Promise<typeof import("./model-switcher-http.js")> | undefined;
let soulModulePromise: Promise<typeof import("./soul-http.js")> | undefined;
let integrationsModulePromise: Promise<typeof import("./integrations-http.js")> | undefined;
let dashboardModulePromise: Promise<typeof import("./dashboard-http.js")> | undefined;
let settingsModulePromise: Promise<typeof import("./settings-http.js")> | undefined;
let missionModulePromise: Promise<typeof import("./mission-http.js")> | undefined;
let soulProposalsModulePromise: Promise<typeof import("./soul-proposals-http.js")> | undefined;
let onboardingModulePromise: Promise<typeof import("./onboarding-http.js")> | undefined;
let templatesHttpModulePromise: Promise<typeof import("./templates-http.js")> | undefined;
let sessionHistoryHttpModulePromise:
  | Promise<typeof import("./sessions-history-http.js")>
  | undefined;
let sessionKillHttpModulePromise: Promise<typeof import("./session-kill-http.js")> | undefined;
let toolsInvokeHttpModulePromise: Promise<typeof import("./tools-invoke-http.js")> | undefined;
let canvasAuthModulePromise: Promise<typeof import("./server/http-auth.js")> | undefined;
let httpAuthUtilsModulePromise: Promise<typeof import("./http-auth-utils.js")> | undefined;
let pluginRouteRuntimeScopesModulePromise:
  | Promise<typeof import("./server/plugin-route-runtime-scopes.js")>
  | undefined;

function getIdentityAvatarModule() {
  identityAvatarModulePromise ??= import("../agents/identity-avatar.js");
  return identityAvatarModulePromise;
}

function getControlUiModule() {
  controlUiModulePromise ??= import("./control-ui.js");
  return controlUiModulePromise;
}

function getEmbeddingsHttpModule() {
  embeddingsHttpModulePromise ??= import("./embeddings-http.js");
  return embeddingsHttpModulePromise;
}

function getManagedImageAttachmentsModule() {
  managedImageAttachmentsModulePromise ??= import("./managed-image-attachments.js");
  return managedImageAttachmentsModulePromise;
}

function getModelsHttpModule() {
  modelsHttpModulePromise ??= import("./models-http.js");
  return modelsHttpModulePromise;
}

function getOpenAiHttpModule() {
  openAiHttpModulePromise ??= import("./openai-http.js");
  return openAiHttpModulePromise;
}

function getOpenResponsesHttpModule() {
  openResponsesHttpModulePromise ??= import("./openresponses-http.js");
  return openResponsesHttpModulePromise;
}

function getOrchestratorHttpModule() {
  orchestratorHttpModulePromise ??= import("./orchestrator-http.js");
  return orchestratorHttpModulePromise;
}

function getProjectsHttpModule() {
  projectsHttpModulePromise ??= import("./projects-http.js");
  return projectsHttpModulePromise;
}

function getSetupHttpModule() {
  setupHttpModulePromise ??= import("./setup-http.js");
  return setupHttpModulePromise;
}

function getChannelsWizardModule() {
  channelsWizardModulePromise ??= import("./channels-wizard.js");
  return channelsWizardModulePromise;
}

function getCapabilitiesHttpModule() {
  capabilitiesHttpModulePromise ??= import("./capabilities-http.js");
  return capabilitiesHttpModulePromise;
}

function getCapabilitiesUiModule() {
  capabilitiesUiModulePromise ??= import("./capabilities-ui.js");
  return capabilitiesUiModulePromise;
}

function getActivityStreamModule() {
  activityStreamModulePromise ??= import("./activity-stream-http.js");
  return activityStreamModulePromise;
}

function getActivityUiModule() {
  activityUiModulePromise ??= import("./activity-ui.js");
  return activityUiModulePromise;
}

function getModelSwitcherModule() {
  modelSwitcherModulePromise ??= import("./model-switcher-http.js");
  return modelSwitcherModulePromise;
}

function getSoulModule() {
  soulModulePromise ??= import("./soul-http.js");
  return soulModulePromise;
}

function getIntegrationsModule() {
  integrationsModulePromise ??= import("./integrations-http.js");
  return integrationsModulePromise;
}

function getDashboardModule() {
  dashboardModulePromise ??= import("./dashboard-http.js");
  return dashboardModulePromise;
}

function getSettingsModule() {
  settingsModulePromise ??= import("./settings-http.js");
  return settingsModulePromise;
}

function getMissionModule() {
  missionModulePromise ??= import("./mission-http.js");
  return missionModulePromise;
}

function getSoulProposalsModule() {
  soulProposalsModulePromise ??= import("./soul-proposals-http.js");
  return soulProposalsModulePromise;
}

function getOnboardingModule() {
  onboardingModulePromise ??= import("./onboarding-http.js");
  return onboardingModulePromise;
}

function getTemplatesHttpModule() {
  templatesHttpModulePromise ??= import("./templates-http.js");
  return templatesHttpModulePromise;
}

function getSessionHistoryHttpModule() {
  sessionHistoryHttpModulePromise ??= import("./sessions-history-http.js");
  return sessionHistoryHttpModulePromise;
}

function getSessionKillHttpModule() {
  sessionKillHttpModulePromise ??= import("./session-kill-http.js");
  return sessionKillHttpModulePromise;
}

function getToolsInvokeHttpModule() {
  toolsInvokeHttpModulePromise ??= import("./tools-invoke-http.js");
  return toolsInvokeHttpModulePromise;
}

function getCanvasAuthModule() {
  canvasAuthModulePromise ??= import("./server/http-auth.js");
  return canvasAuthModulePromise;
}

function getHttpAuthUtilsModule() {
  httpAuthUtilsModulePromise ??= import("./http-auth-utils.js");
  return httpAuthUtilsModulePromise;
}

function getPluginRouteRuntimeScopesModule() {
  pluginRouteRuntimeScopesModulePromise ??= import("./server/plugin-route-runtime-scopes.js");
  return pluginRouteRuntimeScopesModulePromise;
}

const GATEWAY_PROBE_STATUS_BY_PATH = new Map<string, "live" | "ready">([
  ["/health", "live"],
  ["/healthz", "live"],
  ["/ready", "ready"],
  ["/readyz", "ready"],
]);
const pluginGatewayAuthBypassPathsCache = new WeakMap<AlienConfig, Promise<ReadonlySet<string>>>();

async function resolvePluginGatewayAuthBypassPaths(
  configSnapshot: AlienConfig,
): Promise<Set<string>> {
  const paths = new Set<string>();
  const configuredChannels = configSnapshot.channels;
  if (!configuredChannels || Object.keys(configuredChannels).length === 0) {
    return paths;
  }
  for (const channelId of Object.keys(configuredChannels)) {
    for (const path of resolveBundledChannelGatewayAuthBypassPaths({
      channelId,
      cfg: configSnapshot,
    })) {
      paths.add(path);
    }
  }
  return paths;
}

function getCachedPluginGatewayAuthBypassPaths(
  configSnapshot: AlienConfig,
): Promise<ReadonlySet<string>> {
  const cached = pluginGatewayAuthBypassPathsCache.get(configSnapshot);
  if (cached) {
    return cached;
  }
  const resolved = resolvePluginGatewayAuthBypassPaths(configSnapshot).catch((error) => {
    pluginGatewayAuthBypassPathsCache.delete(configSnapshot);
    throw error;
  });
  pluginGatewayAuthBypassPathsCache.set(configSnapshot, resolved);
  return resolved;
}

function isOpenAiModelsPath(pathname: string): boolean {
  return pathname === "/v1/models" || pathname.startsWith("/v1/models/");
}

function isEmbeddingsPath(pathname: string): boolean {
  return pathname === "/v1/embeddings";
}

function isOpenAiChatCompletionsPath(pathname: string): boolean {
  return pathname === "/v1/chat/completions";
}

function isOpenResponsesPath(pathname: string): boolean {
  return pathname === "/v1/responses";
}

function isToolsInvokePath(pathname: string): boolean {
  return pathname === "/tools/invoke";
}

function isManagedOutgoingImagePath(pathname: string): boolean {
  return pathname.startsWith("/api/chat/media/outgoing/");
}

function isSessionKillPath(pathname: string): boolean {
  return /^\/sessions\/[^/]+\/kill$/.test(pathname);
}

function isSessionHistoryPath(pathname: string): boolean {
  return /^\/sessions\/[^/]+\/history$/.test(pathname);
}

function isA2uiPath(pathname: string): boolean {
  return pathname === A2UI_PATH || pathname.startsWith(`${A2UI_PATH}/`);
}

function isCanvasPath(pathname: string): boolean {
  return (
    pathname === A2UI_PATH ||
    pathname.startsWith(`${A2UI_PATH}/`) ||
    pathname === CANVAS_HOST_PATH ||
    pathname.startsWith(`${CANVAS_HOST_PATH}/`) ||
    pathname === CANVAS_WS_PATH
  );
}

function shouldEnforceDefaultPluginGatewayAuth(pathContext: PluginRoutePathContext): boolean {
  return (
    pathContext.malformedEncoding ||
    pathContext.decodePassLimitReached ||
    isProtectedPluginRoutePathFromContext(pathContext)
  );
}

async function canRevealReadinessDetails(params: {
  req: IncomingMessage;
  resolvedAuth: ResolvedGatewayAuth;
  trustedProxies: string[];
  allowRealIpFallback: boolean;
}): Promise<boolean> {
  if (isLocalDirectRequest(params.req, params.trustedProxies, params.allowRealIpFallback)) {
    return true;
  }
  if (params.resolvedAuth.mode === "none") {
    return false;
  }

  const { getBearerToken, resolveHttpBrowserOriginPolicy } = await getHttpAuthUtilsModule();
  const bearerToken = getBearerToken(params.req);
  const authResult = await authorizeHttpGatewayConnect({
    auth: params.resolvedAuth,
    connectAuth: bearerToken ? { token: bearerToken, password: bearerToken } : null,
    req: params.req,
    trustedProxies: params.trustedProxies,
    allowRealIpFallback: params.allowRealIpFallback,
    browserOriginPolicy: resolveHttpBrowserOriginPolicy(params.req),
  });
  return authResult.ok;
}

async function handleGatewayProbeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestPath: string,
  resolvedAuth: ResolvedGatewayAuth,
  trustedProxies: string[],
  allowRealIpFallback: boolean,
  getReadiness?: ReadinessChecker,
): Promise<boolean> {
  const status = GATEWAY_PROBE_STATUS_BY_PATH.get(requestPath);
  if (!status) {
    return false;
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  let statusCode: number;
  let body: string;
  if (status === "ready" && getReadiness) {
    const includeDetails = await canRevealReadinessDetails({
      req,
      resolvedAuth,
      trustedProxies,
      allowRealIpFallback,
    });
    try {
      const result = getReadiness();
      statusCode = result.ready ? 200 : 503;
      body = JSON.stringify(includeDetails ? result : { ready: result.ready });
    } catch {
      statusCode = 503;
      body = JSON.stringify(
        includeDetails ? { ready: false, failing: ["internal"], uptimeMs: 0 } : { ready: false },
      );
    }
  } else {
    statusCode = 200;
    body = JSON.stringify({ ok: true, status });
  }
  res.statusCode = statusCode;
  res.end(method === "HEAD" ? undefined : body);
  return true;
}

function writeUpgradeAuthFailure(
  socket: { write: (chunk: string) => void },
  auth: GatewayAuthResult,
) {
  if (auth.rateLimited) {
    const retryAfterSeconds =
      auth.retryAfterMs && auth.retryAfterMs > 0 ? Math.ceil(auth.retryAfterMs / 1000) : undefined;
    socket.write(
      [
        "HTTP/1.1 429 Too Many Requests",
        retryAfterSeconds ? `Retry-After: ${retryAfterSeconds}` : undefined,
        "Content-Type: application/json; charset=utf-8",
        "Connection: close",
        "",
        JSON.stringify({
          error: {
            message: "Too many failed authentication attempts. Please try again later.",
            type: "rate_limited",
          },
        }),
      ]
        .filter(Boolean)
        .join("\r\n"),
    );
    return;
  }
  socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
}

function writeUpgradeServiceUnavailable(socket: { write: (chunk: string) => void }, body: string) {
  socket.write(
    "HTTP/1.1 503 Service Unavailable\r\n" +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n` +
      "\r\n" +
      body,
  );
}

type GatewayHttpRequestStage = {
  name: string;
  run: () => Promise<boolean> | boolean;
  continueOnError?: boolean;
};

export async function runGatewayHttpRequestStages(
  stages: readonly GatewayHttpRequestStage[],
): Promise<boolean> {
  for (const stage of stages) {
    try {
      if (await stage.run()) {
        return true;
      }
    } catch (err) {
      if (!stage.continueOnError) {
        throw err;
      }
      // Log and skip the failing stage so subsequent stages (control-ui,
      // gateway-probes, etc.) remain reachable. A common trigger is a
      // plugin-owned route/runtime code still failing to load an optional dependency.
      console.error(`[gateway-http] stage "${stage.name}" threw — skipping:`, err);
    }
  }
  return false;
}

function buildPluginRequestStages(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestPath: string;
  getGatewayAuthBypassPaths: () => Promise<ReadonlySet<string>>;
  pluginPathContext: PluginRoutePathContext | null;
  handlePluginRequest?: PluginHttpRequestHandler;
  shouldEnforcePluginGatewayAuth?: (pathContext: PluginRoutePathContext) => boolean;
  resolvedAuth: ResolvedGatewayAuth;
  trustedProxies: string[];
  allowRealIpFallback: boolean;
  rateLimiter?: AuthRateLimiter;
}): GatewayHttpRequestStage[] {
  if (!params.handlePluginRequest) {
    return [];
  }
  let pluginGatewayAuthSatisfied = false;
  let pluginGatewayRequestAuth: AuthorizedGatewayHttpRequest | undefined;
  let pluginRequestOperatorScopes: string[] | undefined;
  return [
    {
      name: "plugin-auth",
      run: async () => {
        const pathContext =
          params.pluginPathContext ?? resolvePluginRoutePathContext(params.requestPath);
        if (
          !(params.shouldEnforcePluginGatewayAuth ?? shouldEnforceDefaultPluginGatewayAuth)(
            pathContext,
          )
        ) {
          return false;
        }
        if ((await params.getGatewayAuthBypassPaths()).has(params.requestPath)) {
          return false;
        }
        const { authorizeGatewayHttpRequestOrReply } = await getHttpAuthUtilsModule();
        const requestAuth = await authorizeGatewayHttpRequestOrReply({
          req: params.req,
          res: params.res,
          auth: params.resolvedAuth,
          trustedProxies: params.trustedProxies,
          allowRealIpFallback: params.allowRealIpFallback,
          rateLimiter: params.rateLimiter,
        });
        if (!requestAuth) {
          return true;
        }
        pluginGatewayAuthSatisfied = true;
        pluginGatewayRequestAuth = requestAuth;
        const { resolvePluginRouteRuntimeOperatorScopes } =
          await getPluginRouteRuntimeScopesModule();
        pluginRequestOperatorScopes = resolvePluginRouteRuntimeOperatorScopes(
          params.req,
          requestAuth,
        );
        return false;
      },
    },
    {
      name: "plugin-http",
      continueOnError: true,
      run: () => {
        const pathContext =
          params.pluginPathContext ?? resolvePluginRoutePathContext(params.requestPath);
        return (
          params.handlePluginRequest?.(params.req, params.res, pathContext, {
            gatewayAuthSatisfied: pluginGatewayAuthSatisfied,
            gatewayRequestAuth: pluginGatewayRequestAuth,
            gatewayRequestOperatorScopes: pluginRequestOperatorScopes,
          }) ?? false
        );
      },
    },
  ];
}

export function createGatewayHttpServer(opts: {
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  controlUiEnabled: boolean;
  controlUiBasePath: string;
  controlUiRoot?: ControlUiRootState;
  openAiChatCompletionsEnabled: boolean;
  openAiChatCompletionsConfig?: import("../config/types.gateway.js").GatewayHttpChatCompletionsConfig;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  strictTransportSecurityHeader?: string;
  handleHooksRequest: HooksRequestHandler;
  handlePluginRequest?: PluginHttpRequestHandler;
  shouldEnforcePluginGatewayAuth?: (pathContext: PluginRoutePathContext) => boolean;
  resolvedAuth: ResolvedGatewayAuth;
  getResolvedAuth?: () => ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
  getReadiness?: ReadinessChecker;
  getRuntimeConfig?: () => AlienConfig;
  tlsOptions?: TlsOptions;
}): HttpServer {
  const {
    canvasHost,
    clients,
    controlUiEnabled,
    controlUiBasePath,
    controlUiRoot,
    openAiChatCompletionsEnabled,
    openAiChatCompletionsConfig,
    openResponsesEnabled,
    openResponsesConfig,
    strictTransportSecurityHeader,
    handleHooksRequest,
    handlePluginRequest,
    shouldEnforcePluginGatewayAuth,
    resolvedAuth,
    rateLimiter,
    getReadiness,
  } = opts;
  const getResolvedAuth = opts.getResolvedAuth ?? (() => resolvedAuth);
  const loadGatewayConfig = opts.getRuntimeConfig ?? getRuntimeConfig;
  const openAiCompatEnabled = openAiChatCompletionsEnabled || openResponsesEnabled;
  const httpServer: HttpServer = opts.tlsOptions
    ? createHttpsServer(opts.tlsOptions, (req, res) => {
        void handleRequestWithTrace(req, res);
      })
    : createHttpServer((req, res) => {
        void handleRequestWithTrace(req, res);
      });

  function handleRequestWithTrace(req: IncomingMessage, res: ServerResponse) {
    return runWithDiagnosticTraceContext(createDiagnosticTraceContext(), () =>
      handleRequest(req, res),
    );
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    setDefaultSecurityHeaders(res, {
      strictTransportSecurity: strictTransportSecurityHeader,
    });

    // Don't interfere with WebSocket upgrades; ws handles the 'upgrade' event.
    if ((req.headers.upgrade ?? "").toLowerCase() === "websocket") {
      return;
    }

    try {
      const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
      if (GATEWAY_PROBE_STATUS_BY_PATH.get(requestPath) === "live") {
        await handleGatewayProbeRequest(
          req,
          res,
          requestPath,
          getResolvedAuth(),
          [],
          false,
          getReadiness,
        );
        return;
      }

      const configSnapshot = loadGatewayConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      const allowRealIpFallback = configSnapshot.gateway?.allowRealIpFallback === true;
      const scopedCanvas = normalizeCanvasScopedUrl(req.url ?? "/");
      if (scopedCanvas.malformedScopedPath) {
        sendGatewayAuthFailure(res, { ok: false, reason: "unauthorized" });
        return;
      }
      if (scopedCanvas.rewrittenUrl) {
        req.url = scopedCanvas.rewrittenUrl;
      }
      const scopedRequestPath = new URL(req.url ?? "/", "http://localhost").pathname;
      const pluginPathContext = handlePluginRequest
        ? resolvePluginRoutePathContext(scopedRequestPath)
        : null;
      const resolvedAuth = getResolvedAuth();
      const requestStages: GatewayHttpRequestStage[] = [
        {
          name: "gateway-probes",
          run: () =>
            handleGatewayProbeRequest(
              req,
              res,
              scopedRequestPath,
              resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              getReadiness,
            ),
        },
        {
          name: "hooks",
          run: () => handleHooksRequest(req, res),
        },
        // Channels wizard. Step-by-step "Add a channel" UX for Telegram /
        // Discord / Slack. Loopback-only, no bearer-token auth required —
        // reachable from /setup (post-OAuth) and from the main UI.
        {
          name: "channels-wizard",
          run: async () => {
            const mod = await getChannelsWizardModule();
            if (!mod.isChannelsWizardPath(scopedRequestPath)) return false;
            return mod.handleChannelsWizardRequest(req, res);
          },
        },
        // First-run setup wizard. Self-gates to loopback only and bypasses
        // bearer-token auth because it runs before any token is configured.
        // For loopback GET / requests we also inject the gateway token into
        // the URL hash so users who hit / directly aren't blocked by the
        // token-paste wall (the wall stays in place for remote/Tailscale).
        {
          name: "setup",
          run: async () => {
            const mod = await getSetupHttpModule();
            if (mod.isSetupPath(scopedRequestPath)) {
              return mod.handleSetupRequest(req, res, { resolvedAuth });
            }
            const isRootGet =
              req.method === "GET" &&
              (scopedRequestPath === "/" || scopedRequestPath === "/index.html");
            if (!isRootGet) return false;
            const isLoopback = Boolean(
              (req.socket?.remoteAddress ?? "").match(/^(127\.|::1|::ffff:127\.)/),
            );
            if (!isLoopback) return false;
            if (mod.isFirstRun()) {
              res.statusCode = 302;
              res.setHeader("Location", "/setup");
              res.setHeader("Cache-Control", "no-store");
              res.end();
              return true;
            }
            // Token handoff: 302 to `/#token=...` once per browser session.
            // Cookie + bearer check prevent the infinite redirect loop that
            // would otherwise fire (URL hashes aren't sent on the follow-up
            // GET, so the server can't tell the handoff already happened).
            const cookieHeader = req.headers.cookie ?? "";
            const alreadyHandedOff = cookieHeader
              .split(/;\s*/)
              .some((c) => c === "alien-token-handoff=done");
            const hasBearer = (req.headers.authorization ?? "").startsWith("Bearer ");
            if (!alreadyHandedOff && !hasBearer && resolvedAuth.token) {
              res.statusCode = 302;
              res.setHeader("Location", `/#token=${encodeURIComponent(resolvedAuth.token)}`);
              res.setHeader(
                "Set-Cookie",
                "alien-token-handoff=done; Max-Age=300; Path=/; SameSite=Lax",
              );
              res.setHeader("Cache-Control", "no-store");
              res.end();
              return true;
            }
            return false;
          },
        },
      ];
      if (openAiCompatEnabled && isOpenAiModelsPath(scopedRequestPath)) {
        requestStages.push({
          name: "models",
          run: async () =>
            (await getModelsHttpModule()).handleOpenAiModelsHttpRequest(req, res, {
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      if (openAiCompatEnabled && isEmbeddingsPath(scopedRequestPath)) {
        requestStages.push({
          name: "embeddings",
          run: async () =>
            (await getEmbeddingsHttpModule()).handleOpenAiEmbeddingsHttpRequest(req, res, {
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      if (isToolsInvokePath(scopedRequestPath)) {
        requestStages.push({
          name: "tools-invoke",
          run: async () =>
            (await getToolsInvokeHttpModule()).handleToolsInvokeHttpRequest(req, res, {
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      if (isSessionKillPath(scopedRequestPath)) {
        requestStages.push({
          name: "sessions-kill",
          run: async () =>
            (await getSessionKillHttpModule()).handleSessionKillHttpRequest(req, res, {
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      if (isSessionHistoryPath(scopedRequestPath)) {
        requestStages.push({
          name: "sessions-history",
          run: async () =>
            (await getSessionHistoryHttpModule()).handleSessionHistoryHttpRequest(req, res, {
              auth: resolvedAuth,
              getResolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      if (openResponsesEnabled && isOpenResponsesPath(scopedRequestPath)) {
        requestStages.push({
          name: "openresponses",
          run: async () =>
            (await getOpenResponsesHttpModule()).handleOpenResponsesHttpRequest(req, res, {
              auth: resolvedAuth,
              config: openResponsesConfig,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      if (openAiChatCompletionsEnabled && isOpenAiChatCompletionsPath(scopedRequestPath)) {
        requestStages.push({
          name: "openai",
          run: async () =>
            (await getOpenAiHttpModule()).handleOpenAiHttpRequest(req, res, {
              auth: resolvedAuth,
              config: openAiChatCompletionsConfig,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      // Orchestrator HTTP API (see src/gateway/orchestrator-http.ts).
      // Same shared-secret bearer auth as the OpenAI surface. Three routes:
      //   GET  /v1/orchestrator/runs
      //   GET  /v1/orchestrator/runs/<runId>
      //   POST /v1/orchestrator/runs
      if ((await getOrchestratorHttpModule()).isOrchestratorRunsPath(scopedRequestPath)) {
        requestStages.push({
          name: "orchestrator",
          run: async () =>
            (await getOrchestratorHttpModule()).handleOrchestratorRequest(req, res, {
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      // Templates HTTP API (read-only). Backs the first-run gallery in
      // the Projects view.
      if ((await getTemplatesHttpModule()).isTemplatesPath(scopedRequestPath)) {
        requestStages.push({
          name: "templates",
          run: async () =>
            (await getTemplatesHttpModule()).handleTemplatesRequest(req, res, {
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      // Projects HTTP API (see src/gateway/projects-http.ts). Backs the
      // Kanban UI; routes are /v1/projects + /v1/projects/<id>/tasks/...
      // Passing cfg lets the handler lazily boot the auto-pickup loop and
      // channel-inbox listener on first request (idempotent singleton).
      if ((await getProjectsHttpModule()).isProjectsPath(scopedRequestPath)) {
        requestStages.push({
          name: "projects",
          run: async () =>
            (await getProjectsHttpModule()).handleProjectsRequest(req, res, {
              auth: resolvedAuth,
              cfg: configSnapshot,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      // Phase D2 follow-up: loopback admin page for capability lifecycle.
      // Fires BEFORE the auth-gated /v1/capabilities/* stage so the page
      // itself loads without a bearer token (its inline JS grabs the
      // token from /v1/setup/status and uses it for POST calls).
      if ((await getCapabilitiesUiModule()).isCapabilitiesUiPath(scopedRequestPath)) {
        requestStages.push({
          name: "capabilities-ui",
          run: async () => (await getCapabilitiesUiModule()).handleCapabilitiesUiRequest(req, res),
        });
      }
      // Live activity feed: /activity HTML page + /v1/projects/audit-stream
      // SSE source. Both loopback-only, no auth — see the modules' own
      // gating. Putting the stream stage here keeps it ahead of the bearer
      // wall that protects most /v1/* endpoints.
      if ((await getActivityUiModule()).isActivityUiPath(scopedRequestPath)) {
        requestStages.push({
          name: "activity-ui",
          run: async () => (await getActivityUiModule()).handleActivityUiRequest(req, res),
        });
      }
      if ((await getActivityStreamModule()).isAuditStreamPath(scopedRequestPath)) {
        requestStages.push({
          name: "activity-stream",
          run: async () => (await getActivityStreamModule()).handleAuditStreamRequest(req, res),
        });
      }
      // /model + /v1/model: change the default agent model without
      // hand-editing alien.json. Loopback-only.
      if ((await getModelSwitcherModule()).isModelSwitcherPath(scopedRequestPath)) {
        requestStages.push({
          name: "model-switcher",
          run: async () => (await getModelSwitcherModule()).handleModelSwitcherRequest(req, res),
        });
      }
      // /soul + /v1/soul: edit SOUL.md / IDENTITY.md / USER.md from a form
      // without hand-editing the workspace files. Loopback-only.
      if ((await getSoulModule()).isSoulPath(scopedRequestPath)) {
        requestStages.push({
          name: "soul",
          run: async () => (await getSoulModule()).handleSoulRequest(req, res),
        });
      }
      // /integrations: ongoing edit + disconnect surface for AI providers
      // (Anthropic, OpenAI). Reuses /v1/setup validate + save endpoints
      // from the page-side JS; adds its own /v1/integrations status +
      // disconnect endpoints. Loopback-only.
      if ((await getIntegrationsModule()).isIntegrationsPath(scopedRequestPath)) {
        requestStages.push({
          name: "integrations",
          run: async () => (await getIntegrationsModule()).handleIntegrationsRequest(req, res),
        });
      }
      // /dashboard: premium home that aggregates projects, channels,
      // activity, capabilities, soul, and integrations into one surface
      // and exposes a "Start a new mission" prompt. Loopback-only.
      if ((await getDashboardModule()).isDashboardPath(scopedRequestPath)) {
        requestStages.push({
          name: "dashboard",
          run: async () => (await getDashboardModule()).handleDashboardRequest(req, res),
        });
      }
      // /settings: hub of cards linking to every settings surface
      // (soul, integrations, model, channels, capabilities) plus
      // read-only facts (workspace path, state dir, gateway). Loopback.
      if ((await getSettingsModule()).isSettingsPath(scopedRequestPath)) {
        requestStages.push({
          name: "settings",
          run: async () => (await getSettingsModule()).handleSettingsRequest(req, res),
        });
      }
      // /mission/<id>, /experts, /v1/experts, /v1/mission/<id>/state —
      // Phase 1: the company-of-experts roster + per-mission Mission
      // Control board. Loopback-only.
      if ((await getMissionModule()).isMissionPath(scopedRequestPath)) {
        requestStages.push({
          name: "mission",
          run: async () => (await getMissionModule()).handleMissionRequest(req, res),
        });
      }
      // /soul-proposals + /v1/soul-proposals/* — Phase 4: the agent's
      // self-improvement review surface. Loopback-only.
      if ((await getSoulProposalsModule()).isSoulProposalsPath(scopedRequestPath)) {
        requestStages.push({
          name: "soul-proposals",
          run: async () => (await getSoulProposalsModule()).handleSoulProposalsRequest(req, res),
        });
      }
      // /onboarding/* — UI-driven first-run wizard. Five steps: welcome,
      // pick brain, sign in, set up soul, done. Reuses /v1/setup + /v1/soul
      // endpoints. Loopback-only.
      if ((await getOnboardingModule()).isOnboardingPath(scopedRequestPath)) {
        requestStages.push({
          name: "onboarding",
          run: async () => (await getOnboardingModule()).handleOnboardingRequest(req, res),
        });
      }
      // Phase C capability operations: list open requests + trigger a
      // self-coder build for a specific request id.
      if ((await getCapabilitiesHttpModule()).isCapabilitiesPath(scopedRequestPath)) {
        requestStages.push({
          name: "capabilities",
          run: async () =>
            (await getCapabilitiesHttpModule()).handleCapabilitiesRequest(req, res, {
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
            }),
        });
      }
      if (canvasHost) {
        requestStages.push({
          name: "canvas-auth",
          run: async () => {
            if (!isCanvasPath(scopedRequestPath)) {
              return false;
            }
            const { authorizeCanvasRequest } = await getCanvasAuthModule();
            const ok = await authorizeCanvasRequest({
              req,
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              clients,
              canvasCapability: scopedCanvas.capability,
              malformedScopedPath: scopedCanvas.malformedScopedPath,
              rateLimiter,
            });
            if (!ok.ok) {
              sendGatewayAuthFailure(res, ok);
              return true;
            }
            return false;
          },
        });
        requestStages.push({
          name: "a2ui",
          run: () => (isA2uiPath(scopedRequestPath) ? handleA2uiHttpRequest(req, res) : false),
        });
        requestStages.push({
          name: "canvas-http",
          run: () => canvasHost.handleHttpRequest(req, res),
        });
      }
      // Plugin routes run before the Control UI SPA catch-all so explicitly
      // registered plugin endpoints stay reachable. Core built-in gateway
      // routes above still keep precedence on overlapping paths.
      requestStages.push(
        ...buildPluginRequestStages({
          req,
          res,
          requestPath: scopedRequestPath,
          getGatewayAuthBypassPaths: () => getCachedPluginGatewayAuthBypassPaths(configSnapshot),
          pluginPathContext,
          handlePluginRequest,
          shouldEnforcePluginGatewayAuth,
          resolvedAuth,
          trustedProxies,
          allowRealIpFallback,
          rateLimiter,
        }),
      );

      if (isManagedOutgoingImagePath(scopedRequestPath)) {
        requestStages.push({
          name: "chat-managed-image-media",
          run: async () =>
            (await getManagedImageAttachmentsModule()).handleManagedOutgoingImageHttpRequest(
              req,
              res,
              {
                auth: resolvedAuth,
                trustedProxies,
                allowRealIpFallback,
                rateLimiter,
              },
            ),
        });
      }

      if (controlUiEnabled) {
        requestStages.push({
          name: "control-ui-assistant-media",
          run: async () =>
            (await getControlUiModule()).handleControlUiAssistantMediaRequest(req, res, {
              basePath: controlUiBasePath,
              config: configSnapshot,
              agentId: resolveAssistantIdentity({ cfg: configSnapshot }).agentId,
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
        requestStages.push({
          name: "control-ui-avatar",
          run: async () => {
            const { handleControlUiAvatarRequest } = await getControlUiModule();
            const { resolveAgentAvatar } = await getIdentityAvatarModule();
            return handleControlUiAvatarRequest(req, res, {
              basePath: controlUiBasePath,
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
              resolveAvatar: (agentId) =>
                resolveAgentAvatar(configSnapshot, agentId, { includeUiOverride: true }),
            });
          },
        });
        requestStages.push({
          name: "control-ui-http",
          run: async () =>
            (await getControlUiModule()).handleControlUiHttpRequest(req, res, {
              basePath: controlUiBasePath,
              config: configSnapshot,
              agentId: resolveAssistantIdentity({ cfg: configSnapshot }).agentId,
              root: controlUiRoot,
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }

      if (await runGatewayHttpRequestStages(requestStages)) {
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch (err) {
      console.error("[gateway-http] unhandled error in request handler:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }

  return httpServer;
}

export function attachGatewayUpgradeHandler(opts: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  preauthConnectionBudget: PreauthConnectionBudget;
  resolvedAuth: ResolvedGatewayAuth;
  getResolvedAuth?: () => ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
  /** Optional logger for error diagnostics. */
  log?: { warn: (msg: string) => void };
}) {
  const {
    httpServer,
    wss,
    canvasHost,
    clients,
    preauthConnectionBudget,
    resolvedAuth,
    rateLimiter,
    log,
  } = opts;
  const getResolvedAuth = opts.getResolvedAuth ?? (() => resolvedAuth);
  httpServer.on("upgrade", (req, socket, head) => {
    void runWithDiagnosticTraceContext(createDiagnosticTraceContext(), async () => {
      const configSnapshot = getRuntimeConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      const allowRealIpFallback = configSnapshot.gateway?.allowRealIpFallback === true;
      const scopedCanvas = normalizeCanvasScopedUrl(req.url ?? "/");
      if (scopedCanvas.malformedScopedPath) {
        writeUpgradeAuthFailure(socket, { ok: false, reason: "unauthorized" });
        socket.destroy();
        return;
      }
      if (scopedCanvas.rewrittenUrl) {
        req.url = scopedCanvas.rewrittenUrl;
      }
      const resolvedAuth = getResolvedAuth();
      const url = new URL(req.url ?? "/", "http://localhost");
      if (canvasHost) {
        if (url.pathname === CANVAS_WS_PATH) {
          const { authorizeCanvasRequest } = await getCanvasAuthModule();
          const ok = await authorizeCanvasRequest({
            req,
            auth: resolvedAuth,
            trustedProxies,
            allowRealIpFallback,
            clients,
            canvasCapability: scopedCanvas.capability,
            malformedScopedPath: scopedCanvas.malformedScopedPath,
            rateLimiter,
          });
          if (!ok.ok) {
            writeUpgradeAuthFailure(socket, ok);
            socket.destroy();
            return;
          }
        }
        if (canvasHost.handleUpgrade(req, socket, head)) {
          return;
        }
      }
      const preauthBudgetKey = resolveRequestClientIp(req, trustedProxies, allowRealIpFallback);
      if (wss.listenerCount("connection") === 0) {
        writeUpgradeServiceUnavailable(socket, "Gateway websocket handlers unavailable");
        socket.destroy();
        return;
      }
      if (!preauthConnectionBudget.acquire(preauthBudgetKey)) {
        writeUpgradeServiceUnavailable(socket, "Too many unauthenticated sockets");
        socket.destroy();
        return;
      }
      let budgetTransferred = false;
      const releaseUpgradeBudget = () => {
        if (budgetTransferred) {
          return;
        }
        budgetTransferred = true;
        preauthConnectionBudget.release(preauthBudgetKey);
      };
      socket.once("close", releaseUpgradeBudget);
      try {
        wss.handleUpgrade(req, socket, head, (ws) => {
          (
            ws as unknown as import("ws").WebSocket & {
              __alienPreauthBudgetClaimed?: boolean;
              __alienPreauthBudgetKey?: string;
            }
          ).__alienPreauthBudgetKey = preauthBudgetKey;
          wss.emit("connection", ws, req);
          const budgetClaimed = Boolean(
            (
              ws as unknown as import("ws").WebSocket & {
                __alienPreauthBudgetClaimed?: boolean;
              }
            ).__alienPreauthBudgetClaimed,
          );
          if (budgetClaimed) {
            budgetTransferred = true;
            socket.off("close", releaseUpgradeBudget);
          }
        });
      } catch {
        socket.off("close", releaseUpgradeBudget);
        releaseUpgradeBudget();
        throw new Error("gateway websocket upgrade failed");
      }
    }).catch((err) => {
      const remoteAddress = (socket as { remoteAddress?: string }).remoteAddress ?? "unknown";
      const errorMessage = err instanceof Error ? err.message : String(err);
      log?.warn(`ws upgrade error from ${remoteAddress}: ${errorMessage}`);
      socket.destroy();
    });
  });
}
