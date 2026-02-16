import { type Api, type Model } from "@mariozechner/pi-ai";
import path from "node:path";
import type { SpecialAgentConfig } from "../config/config.js";
import type { ModelProviderAuthMode, ModelProviderConfig } from "../config/types.js";
import { formatCliCommand } from "../cli/command-format.js";
import { getShellEnvAppliedKeys } from "../infra/shell-env.js";
import {
  normalizeOptionalSecretInput,
  normalizeSecretInput,
} from "../utils/normalize-secret-input.js";
import {
  type AuthProfileStore,
  ensureAuthProfileStore,
  listProfilesForProvider,
  resolveApiKeyForProfile,
  resolveAuthProfileOrder,
  resolveAuthStorePathForDisplay,
} from "./auth-profiles.js";
import { normalizeProviderId } from "./model-selection.js";

export { ensureAuthProfileStore, resolveAuthProfileOrder } from "./auth-profiles.js";

function resolveProviderConfig(
  cfg: SpecialAgentConfig | undefined,
  provider: string,
): ModelProviderConfig | undefined {
  const providers = cfg?.models?.providers ?? {};
  const direct = providers[provider] as ModelProviderConfig | undefined;
  if (direct) {
    return direct;
  }
  const normalized = normalizeProviderId(provider);
  if (normalized === provider) {
    const matched = Object.entries(providers).find(
      ([key]) => normalizeProviderId(key) === normalized,
    );
    return matched?.[1];
  }
  return (
    (providers[normalized] as ModelProviderConfig | undefined) ??
    Object.entries(providers).find(([key]) => normalizeProviderId(key) === normalized)?.[1]
  );
}

export function getCustomProviderApiKey(
  cfg: SpecialAgentConfig | undefined,
  provider: string,
): string | undefined {
  const entry = resolveProviderConfig(cfg, provider);
  return normalizeOptionalSecretInput(entry?.apiKey);
}

function resolveProviderAuthOverride(
  cfg: SpecialAgentConfig | undefined,
  provider: string,
): ModelProviderAuthMode | undefined {
  const entry = resolveProviderConfig(cfg, provider);
  const auth = entry?.auth;
  if (auth === "api-key" || auth === "oauth" || auth === "token") {
    return auth;
  }
  return undefined;
}

function resolveEnvSourceLabel(params: {
  applied: Set<string>;
  envVars: string[];
  label: string;
}): string {
  const shellApplied = params.envVars.some((envVar) => params.applied.has(envVar));
  const prefix = shellApplied ? "shell env: " : "env: ";
  return `${prefix}${params.label}`;
}

export type ResolvedProviderAuth = {
  apiKey?: string;
  profileId?: string;
  source: string;
  mode: "api-key" | "oauth" | "token";
};

export async function resolveApiKeyForProvider(params: {
  provider: string;
  cfg?: SpecialAgentConfig;
  profileId?: string;
  preferredProfile?: string;
  store?: AuthProfileStore;
  agentDir?: string;
}): Promise<ResolvedProviderAuth> {
  const { provider, cfg, profileId, preferredProfile } = params;
  const store = params.store ?? ensureAuthProfileStore(params.agentDir);

  if (profileId) {
    const resolved = await resolveApiKeyForProfile({
      cfg,
      store,
      profileId,
      agentDir: params.agentDir,
    });
    if (!resolved) {
      throw new Error(`No credentials found for profile "${profileId}".`);
    }
    const mode = store.profiles[profileId]?.type;
    return {
      apiKey: resolved.apiKey,
      profileId,
      source: `profile:${profileId}`,
      mode: mode === "oauth" ? "oauth" : mode === "token" ? "token" : "api-key",
    };
  }

  const order = resolveAuthProfileOrder({
    cfg,
    store,
    provider,
    preferredProfile,
  });
  for (const candidate of order) {
    try {
      const resolved = await resolveApiKeyForProfile({
        cfg,
        store,
        profileId: candidate,
        agentDir: params.agentDir,
      });
      if (resolved) {
        const mode = store.profiles[candidate]?.type;
        return {
          apiKey: resolved.apiKey,
          profileId: candidate,
          source: `profile:${candidate}`,
          mode: mode === "oauth" ? "oauth" : mode === "token" ? "token" : "api-key",
        };
      }
    } catch {}
  }

  const envResolved = resolveEnvApiKey(provider);
  if (envResolved) {
    return {
      apiKey: envResolved.apiKey,
      source: envResolved.source,
      mode: "api-key",
    };
  }

  const customKey = getCustomProviderApiKey(cfg, provider);
  if (customKey) {
    return { apiKey: customKey, source: "models.json", mode: "api-key" };
  }

  // Custom providers with a baseUrl and no apiKey field at all (e.g. Ollama)
  // should be allowed through without auth.  Use a placeholder value so the
  // SDK auth storage treats it as configured; the endpoint will ignore it.
  const providerCfg = resolveProviderConfig(cfg, provider);
  if (providerCfg?.baseUrl && !("apiKey" in providerCfg)) {
    return { apiKey: "unused", source: "custom-provider-no-key", mode: "api-key" };
  }

  const authStorePath = resolveAuthStorePathForDisplay(params.agentDir);
  const resolvedAgentDir = path.dirname(authStorePath);
  throw new Error(
    [
      `No API key found for provider "${provider}".`,
      `Auth store: ${authStorePath} (agentDir: ${resolvedAgentDir}).`,
      `Configure auth for this agent (${formatCliCommand("special-agent agents add <id>")}) or copy auth-profiles.json from the main agentDir.`,
    ].join(" "),
  );
}

export type EnvApiKeyResult = { apiKey: string; source: string };
export type ModelAuthMode = "api-key" | "oauth" | "token" | "mixed" | "unknown";

/**
 * Resolve API key from environment variables for a provider.
 * Uses a generic approach: looks for <PROVIDER>_API_KEY in the environment.
 */
export function resolveEnvApiKey(provider: string): EnvApiKeyResult | null {
  const normalized = normalizeProviderId(provider);
  const applied = new Set(getShellEnvAppliedKeys());
  const pick = (envVar: string): EnvApiKeyResult | null => {
    const value = normalizeOptionalSecretInput(process.env[envVar]);
    if (!value) {
      return null;
    }
    const source = applied.has(envVar) ? `shell env: ${envVar}` : `env: ${envVar}`;
    return { apiKey: value, source };
  };

  // Generic: try <UPPER_PROVIDER>_API_KEY
  const envVar = `${normalized.replace(/-/g, "_").toUpperCase()}_API_KEY`;
  return pick(envVar);
}

export function resolveModelAuthMode(
  provider?: string,
  cfg?: SpecialAgentConfig,
  store?: AuthProfileStore,
): ModelAuthMode | undefined {
  const resolved = provider?.trim();
  if (!resolved) {
    return undefined;
  }

  const authStore = store ?? ensureAuthProfileStore();
  const profiles = listProfilesForProvider(authStore, resolved);
  if (profiles.length > 0) {
    const modes = new Set(
      profiles
        .map((id) => authStore.profiles[id]?.type)
        .filter((mode): mode is "api_key" | "oauth" | "token" => Boolean(mode)),
    );
    const distinct = ["oauth", "token", "api_key"].filter((k) =>
      modes.has(k as "oauth" | "token" | "api_key"),
    );
    if (distinct.length >= 2) {
      return "mixed";
    }
    if (modes.has("oauth")) {
      return "oauth";
    }
    if (modes.has("token")) {
      return "token";
    }
    if (modes.has("api_key")) {
      return "api-key";
    }
  }

  const envKey = resolveEnvApiKey(resolved);
  if (envKey?.apiKey) {
    return "api-key";
  }

  if (getCustomProviderApiKey(cfg, resolved)) {
    return "api-key";
  }

  return "unknown";
}

export async function getApiKeyForModel(params: {
  model: Model<Api>;
  cfg?: SpecialAgentConfig;
  profileId?: string;
  preferredProfile?: string;
  store?: AuthProfileStore;
  agentDir?: string;
}): Promise<ResolvedProviderAuth> {
  return resolveApiKeyForProvider({
    provider: params.model.provider,
    cfg: params.cfg,
    profileId: params.profileId,
    preferredProfile: params.preferredProfile,
    store: params.store,
    agentDir: params.agentDir,
  });
}

export function requireApiKey(auth: ResolvedProviderAuth, provider: string): string {
  const key = normalizeSecretInput(auth.apiKey);
  if (key) {
    return key;
  }
  throw new Error(`No API key resolved for provider "${provider}" (auth mode: ${auth.mode}).`);
}
