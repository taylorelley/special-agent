import type { SpecialAgentConfig } from "../config/config.js";
import { ensureAuthProfileStore, listProfilesForProvider } from "./auth-profiles.js";
import { resolveEnvApiKey } from "./model-auth.js";

type ModelsConfig = NonNullable<SpecialAgentConfig["models"]>;
export type ProviderConfig = NonNullable<ModelsConfig["providers"]>[string];

function normalizeApiKeyConfig(value: string): string {
  const trimmed = value.trim();
  const match = /^\$\{([A-Z0-9_]+)\}$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function resolveEnvApiKeyVarName(provider: string): string | undefined {
  const resolved = resolveEnvApiKey(provider);
  if (!resolved) {
    return undefined;
  }
  const match = /^(?:env: |shell env: )([A-Z0-9_]+)$/.exec(resolved.source);
  return match ? match[1] : undefined;
}

function resolveApiKeyFromProfiles(params: {
  provider: string;
  store: ReturnType<typeof ensureAuthProfileStore>;
}): string | undefined {
  const ids = listProfilesForProvider(params.store, params.provider);
  for (const id of ids) {
    const cred = params.store.profiles[id];
    if (!cred) {
      continue;
    }
    if (cred.type === "api_key") {
      return cred.key;
    }
    if (cred.type === "token") {
      return cred.token;
    }
  }
  return undefined;
}

export function normalizeProviders(params: {
  providers: ModelsConfig["providers"];
  agentDir: string;
}): ModelsConfig["providers"] {
  const { providers } = params;
  if (!providers) {
    return providers;
  }
  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });
  let mutated = false;
  const next: Record<string, ProviderConfig> = {};

  for (const [key, provider] of Object.entries(providers)) {
    let normalizedProvider = provider;

    // Fix common misconfig: apiKey set to "${ENV_VAR}" instead of "ENV_VAR".
    if (
      normalizedProvider.apiKey &&
      normalizeApiKeyConfig(normalizedProvider.apiKey) !== normalizedProvider.apiKey
    ) {
      mutated = true;
      normalizedProvider = {
        ...normalizedProvider,
        apiKey: normalizeApiKeyConfig(normalizedProvider.apiKey),
      };
    }

    // If a provider defines models, pi's ModelRegistry requires apiKey to be set.
    // Fill it from the environment or auth profiles when possible.
    const hasModels =
      Array.isArray(normalizedProvider.models) && normalizedProvider.models.length > 0;
    if (hasModels && !normalizedProvider.apiKey?.trim()) {
      const fromEnv = resolveEnvApiKeyVarName(key.trim());
      const fromProfiles = resolveApiKeyFromProfiles({
        provider: key.trim(),
        store: authStore,
      });
      const apiKey = fromEnv ?? fromProfiles;
      if (apiKey?.trim()) {
        mutated = true;
        normalizedProvider = { ...normalizedProvider, apiKey };
      }
    }

    next[key] = normalizedProvider;
  }

  return mutated ? next : providers;
}
