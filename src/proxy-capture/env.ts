import { randomUUID } from "node:crypto";
import type { Agent } from "node:http";
import { createRequire } from "node:module";
import process from "node:process";
import {
  resolveDebugProxyBlobDir,
  resolveDebugProxyCertDir,
  resolveDebugProxyDbPath,
} from "./paths.js";

export const ALIEN_DEBUG_PROXY_ENABLED = "ALIEN_DEBUG_PROXY_ENABLED";
export const ALIEN_DEBUG_PROXY_URL = "ALIEN_DEBUG_PROXY_URL";
export const ALIEN_DEBUG_PROXY_DB_PATH = "ALIEN_DEBUG_PROXY_DB_PATH";
export const ALIEN_DEBUG_PROXY_BLOB_DIR = "ALIEN_DEBUG_PROXY_BLOB_DIR";
export const ALIEN_DEBUG_PROXY_CERT_DIR = "ALIEN_DEBUG_PROXY_CERT_DIR";
export const ALIEN_DEBUG_PROXY_SESSION_ID = "ALIEN_DEBUG_PROXY_SESSION_ID";
export const ALIEN_DEBUG_PROXY_REQUIRE = "ALIEN_DEBUG_PROXY_REQUIRE";

export type DebugProxySettings = {
  enabled: boolean;
  required: boolean;
  proxyUrl?: string;
  dbPath: string;
  blobDir: string;
  certDir: string;
  sessionId: string;
  sourceProcess: string;
};

let cachedImplicitSessionId: string | undefined;
let cachedHttpsProxyAgent: typeof import("https-proxy-agent").HttpsProxyAgent | undefined;

function loadHttpsProxyAgent(): typeof import("https-proxy-agent").HttpsProxyAgent {
  cachedHttpsProxyAgent ??= (
    createRequire(import.meta.url)("https-proxy-agent") as typeof import("https-proxy-agent")
  ).HttpsProxyAgent;
  return cachedHttpsProxyAgent;
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function resolveDebugProxySettings(
  env: NodeJS.ProcessEnv = process.env,
): DebugProxySettings {
  const enabled = isTruthy(env[ALIEN_DEBUG_PROXY_ENABLED]);
  const explicitSessionId = env[ALIEN_DEBUG_PROXY_SESSION_ID]?.trim() || undefined;
  const sessionId = explicitSessionId ?? (cachedImplicitSessionId ??= randomUUID());
  return {
    enabled,
    required: isTruthy(env[ALIEN_DEBUG_PROXY_REQUIRE]),
    proxyUrl: env[ALIEN_DEBUG_PROXY_URL]?.trim() || undefined,
    dbPath: env[ALIEN_DEBUG_PROXY_DB_PATH]?.trim() || resolveDebugProxyDbPath(env),
    blobDir: env[ALIEN_DEBUG_PROXY_BLOB_DIR]?.trim() || resolveDebugProxyBlobDir(env),
    certDir: env[ALIEN_DEBUG_PROXY_CERT_DIR]?.trim() || resolveDebugProxyCertDir(env),
    sessionId,
    sourceProcess: "alien",
  };
}

export function applyDebugProxyEnv(
  env: NodeJS.ProcessEnv,
  params: {
    proxyUrl: string;
    sessionId: string;
    dbPath?: string;
    blobDir?: string;
    certDir?: string;
  },
): NodeJS.ProcessEnv {
  return {
    ...env,
    [ALIEN_DEBUG_PROXY_ENABLED]: "1",
    [ALIEN_DEBUG_PROXY_REQUIRE]: "1",
    [ALIEN_DEBUG_PROXY_URL]: params.proxyUrl,
    [ALIEN_DEBUG_PROXY_DB_PATH]: params.dbPath ?? resolveDebugProxyDbPath(env),
    [ALIEN_DEBUG_PROXY_BLOB_DIR]: params.blobDir ?? resolveDebugProxyBlobDir(env),
    [ALIEN_DEBUG_PROXY_CERT_DIR]: params.certDir ?? resolveDebugProxyCertDir(env),
    [ALIEN_DEBUG_PROXY_SESSION_ID]: params.sessionId,
    HTTP_PROXY: params.proxyUrl,
    HTTPS_PROXY: params.proxyUrl,
    ALL_PROXY: params.proxyUrl,
  };
}

export function createDebugProxyWebSocketAgent(settings: DebugProxySettings): Agent | undefined {
  if (!settings.enabled || !settings.proxyUrl) {
    return undefined;
  }
  const HttpsProxyAgent = loadHttpsProxyAgent();
  return new HttpsProxyAgent(settings.proxyUrl);
}

export function resolveEffectiveDebugProxyUrl(configuredProxyUrl?: string): string | undefined {
  const explicit = configuredProxyUrl?.trim();
  if (explicit) {
    return explicit;
  }
  const settings = resolveDebugProxySettings();
  return settings.enabled ? settings.proxyUrl : undefined;
}
