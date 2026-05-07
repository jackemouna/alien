import type { AlienConfig } from "../config/types.alien.js";
import type { PluginEntryConfig } from "../config/types.plugins.js";
import { hasExplicitPluginConfig } from "./config-policy.js";
import { normalizePluginId } from "./config-state.js";

export function withBundledPluginAllowlistCompat(params: {
  config: AlienConfig | undefined;
  pluginIds: readonly string[];
}): AlienConfig | undefined {
  if (params.config?.plugins?.bundledDiscovery !== "compat") {
    return params.config;
  }
  const allow = params.config?.plugins?.allow;
  if (!Array.isArray(allow) || allow.length === 0) {
    return params.config;
  }

  const allowSet = new Set(allow.map((entry) => entry.trim()).filter(Boolean));
  let changed = false;
  for (const pluginId of params.pluginIds) {
    if (!allowSet.has(pluginId)) {
      allowSet.add(pluginId);
      changed = true;
    }
  }

  if (!changed) {
    return params.config;
  }

  return {
    ...params.config,
    plugins: {
      ...params.config?.plugins,
      allow: [...allowSet],
    },
  };
}

export function withBundledPluginEnablementCompat(params: {
  config: AlienConfig | undefined;
  pluginIds: readonly string[];
}): AlienConfig | undefined {
  const existingEntries = params.config?.plugins?.entries ?? {};
  const forcePluginsEnabled = params.config?.plugins?.enabled === false;
  const useCompatDiscovery = params.config?.plugins?.bundledDiscovery === "compat";
  const allow = params.config?.plugins?.allow;
  const allowSet =
    !useCompatDiscovery && Array.isArray(allow) && allow.length > 0
      ? new Set(allow.map((pluginId) => normalizePluginId(pluginId)).filter(Boolean))
      : undefined;
  let hasEligiblePlugin = false;
  let changed = false;
  const nextEntries: Record<string, PluginEntryConfig> = { ...existingEntries };

  for (const pluginId of params.pluginIds) {
    if (allowSet && !allowSet.has(pluginId)) {
      continue;
    }
    hasEligiblePlugin = true;
    if (existingEntries[pluginId] !== undefined) {
      continue;
    }
    nextEntries[pluginId] = { enabled: true };
    changed = true;
  }

  if (!changed) {
    if (!forcePluginsEnabled || !hasEligiblePlugin) {
      return params.config;
    }
  }

  return {
    ...params.config,
    plugins: {
      ...params.config?.plugins,
      ...(forcePluginsEnabled ? { enabled: true } : {}),
      entries: {
        ...existingEntries,
        ...nextEntries,
      },
    },
  };
}

export function withBundledPluginVitestCompat(params: {
  config: AlienConfig | undefined;
  pluginIds: readonly string[];
  env?: NodeJS.ProcessEnv;
}): AlienConfig | undefined {
  const env = params.env ?? process.env;
  const isVitest = Boolean(env.VITEST);
  if (
    !isVitest ||
    hasExplicitPluginConfig(params.config?.plugins) ||
    params.pluginIds.length === 0
  ) {
    return params.config;
  }

  const entries = Object.fromEntries(
    params.pluginIds.map((pluginId) => [pluginId, { enabled: true } satisfies PluginEntryConfig]),
  );

  return {
    ...params.config,
    plugins: {
      ...params.config?.plugins,
      enabled: true,
      allow: [...params.pluginIds],
      entries: {
        ...entries,
        ...params.config?.plugins?.entries,
      },
      slots: {
        ...params.config?.plugins?.slots,
        memory: "none",
      },
    },
  };
}
