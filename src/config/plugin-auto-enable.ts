import type { SpecialAgentConfig } from "./config.js";
import { normalizeProviderId } from "../agents/model-selection.js";
import { isRecord } from "../utils.js";

type PluginEnableChange = {
  pluginId: string;
  reason: string;
};

export type PluginAutoEnableResult = {
  config: SpecialAgentConfig;
  changes: string[];
};

const CHANNEL_PLUGIN_IDS: string[] = [];

const PROVIDER_PLUGIN_IDS: Array<{ pluginId: string; providerId: string }> = [];

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function recordHasKeys(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

function resolveChannelConfig(
  cfg: SpecialAgentConfig,
  channelId: string,
): Record<string, unknown> | null {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const entry = channels?.[channelId];
  return isRecord(entry) ? entry : null;
}

function isGenericChannelConfigured(cfg: SpecialAgentConfig, channelId: string): boolean {
  const entry = resolveChannelConfig(cfg, channelId);
  return recordHasKeys(entry);
}

export function isChannelConfigured(
  cfg: SpecialAgentConfig,
  channelId: string,
  _env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isGenericChannelConfigured(cfg, channelId);
}

function collectModelRefs(cfg: SpecialAgentConfig): string[] {
  const refs: string[] = [];
  const pushModelRef = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      refs.push(value.trim());
    }
  };
  const collectFromAgent = (agent: Record<string, unknown> | null | undefined) => {
    if (!agent) {
      return;
    }
    const model = agent.model;
    if (typeof model === "string") {
      pushModelRef(model);
    } else if (isRecord(model)) {
      pushModelRef(model.primary);
      const fallbacks = model.fallbacks;
      if (Array.isArray(fallbacks)) {
        for (const entry of fallbacks) {
          pushModelRef(entry);
        }
      }
    }
    const models = agent.models;
    if (isRecord(models)) {
      for (const key of Object.keys(models)) {
        pushModelRef(key);
      }
    }
  };

  const defaults = cfg.agents?.defaults as Record<string, unknown> | undefined;
  collectFromAgent(defaults);

  const list = cfg.agents?.list;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (isRecord(entry)) {
        collectFromAgent(entry);
      }
    }
  }
  return refs;
}

function extractProviderFromModelRef(value: string): string | null {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  return normalizeProviderId(trimmed.slice(0, slash));
}

function isProviderConfigured(cfg: SpecialAgentConfig, providerId: string): boolean {
  const normalized = normalizeProviderId(providerId);

  const profiles = cfg.auth?.profiles;
  if (profiles && typeof profiles === "object") {
    for (const profile of Object.values(profiles)) {
      if (!isRecord(profile)) {
        continue;
      }
      const provider = normalizeProviderId(String(profile.provider ?? ""));
      if (provider === normalized) {
        return true;
      }
    }
  }

  const providerConfig = cfg.models?.providers;
  if (providerConfig && typeof providerConfig === "object") {
    for (const key of Object.keys(providerConfig)) {
      if (normalizeProviderId(key) === normalized) {
        return true;
      }
    }
  }

  const modelRefs = collectModelRefs(cfg);
  for (const ref of modelRefs) {
    const provider = extractProviderFromModelRef(ref);
    if (provider && provider === normalized) {
      return true;
    }
  }

  return false;
}

function resolveConfiguredPlugins(
  cfg: SpecialAgentConfig,
  env: NodeJS.ProcessEnv,
): PluginEnableChange[] {
  const changes: PluginEnableChange[] = [];
  const channelIds = new Set(CHANNEL_PLUGIN_IDS);
  const configuredChannels = cfg.channels as Record<string, unknown> | undefined;
  if (configuredChannels && typeof configuredChannels === "object") {
    for (const key of Object.keys(configuredChannels)) {
      if (key === "defaults") {
        continue;
      }
      channelIds.add(key);
    }
  }
  for (const channelId of channelIds) {
    if (!channelId) {
      continue;
    }
    if (isChannelConfigured(cfg, channelId, env)) {
      changes.push({
        pluginId: channelId,
        reason: `${channelId} configured`,
      });
    }
  }
  for (const mapping of PROVIDER_PLUGIN_IDS) {
    if (isProviderConfigured(cfg, mapping.providerId)) {
      changes.push({
        pluginId: mapping.pluginId,
        reason: `${mapping.providerId} auth configured`,
      });
    }
  }
  return changes;
}

function isPluginExplicitlyDisabled(cfg: SpecialAgentConfig, pluginId: string): boolean {
  const entry = cfg.plugins?.entries?.[pluginId];
  return entry?.enabled === false;
}

function isPluginDenied(cfg: SpecialAgentConfig, pluginId: string): boolean {
  const deny = cfg.plugins?.deny;
  return Array.isArray(deny) && deny.includes(pluginId);
}

function resolvePreferredOverIds(_pluginId: string): string[] {
  return [];
}

function shouldSkipPreferredPluginAutoEnable(
  cfg: SpecialAgentConfig,
  entry: PluginEnableChange,
  configured: PluginEnableChange[],
): boolean {
  for (const other of configured) {
    if (other.pluginId === entry.pluginId) {
      continue;
    }
    if (isPluginDenied(cfg, other.pluginId)) {
      continue;
    }
    if (isPluginExplicitlyDisabled(cfg, other.pluginId)) {
      continue;
    }
    const preferOver = resolvePreferredOverIds(other.pluginId);
    if (preferOver.includes(entry.pluginId)) {
      return true;
    }
  }
  return false;
}

function ensureAllowlisted(cfg: SpecialAgentConfig, pluginId: string): SpecialAgentConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}

function registerPluginEntry(cfg: SpecialAgentConfig, pluginId: string): SpecialAgentConfig {
  const entries = {
    ...cfg.plugins?.entries,
    [pluginId]: {
      ...(cfg.plugins?.entries?.[pluginId] as Record<string, unknown> | undefined),
      enabled: false,
    },
  };
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      entries,
    },
  };
}

function formatAutoEnableChange(entry: PluginEnableChange): string {
  const reason = entry.reason.trim();
  return `${reason}, not enabled yet.`;
}

export function applyPluginAutoEnable(params: {
  config: SpecialAgentConfig;
  env?: NodeJS.ProcessEnv;
}): PluginAutoEnableResult {
  const env = params.env ?? process.env;
  const configured = resolveConfiguredPlugins(params.config, env);
  if (configured.length === 0) {
    return { config: params.config, changes: [] };
  }

  let next = params.config;
  const changes: string[] = [];

  if (next.plugins?.enabled === false) {
    return { config: next, changes };
  }

  for (const entry of configured) {
    if (isPluginDenied(next, entry.pluginId)) {
      continue;
    }
    if (isPluginExplicitlyDisabled(next, entry.pluginId)) {
      continue;
    }
    if (shouldSkipPreferredPluginAutoEnable(next, entry, configured)) {
      continue;
    }
    const allow = next.plugins?.allow;
    const allowMissing = Array.isArray(allow) && !allow.includes(entry.pluginId);
    const alreadyEnabled = next.plugins?.entries?.[entry.pluginId]?.enabled === true;
    if (alreadyEnabled && !allowMissing) {
      continue;
    }
    next = registerPluginEntry(next, entry.pluginId);
    next = ensureAllowlisted(next, entry.pluginId);
    changes.push(formatAutoEnableChange(entry));
  }

  return { config: next, changes };
}
