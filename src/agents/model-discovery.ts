import type { SpecialAgentConfig } from "../config/config.js";
import type { ModelCatalogEntry } from "./model-catalog.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";

const DISCOVERY_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

type CachedResult = {
  entries: ModelCatalogEntry[];
  expiresAt: number;
};

const cache = new Map<string, CachedResult>();

/**
 * Discover models from an OpenAI-compatible /v1/models endpoint.
 */
export async function discoverModelsForEndpoint(params: {
  baseUrl: string;
  api?: string;
  apiKey?: string;
  provider: string;
}): Promise<ModelCatalogEntry[]> {
  const { baseUrl, api, apiKey, provider } = params;

  // Only OpenAI-compatible endpoints support the /models endpoint
  if (api && api !== "openai-completions") {
    return [];
  }

  const cacheKey = `${provider}:${baseUrl}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.entries;
  }

  try {
    const normalizedUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const url = new URL("models", normalizedUrl).href;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetchWithTimeout(url, { method: "GET", headers }, DISCOVERY_TIMEOUT_MS);

    if (!res.ok) {
      return [];
    }

    const json = (await res.json()) as {
      data?: Array<{ id?: string; object?: string; owned_by?: string }>;
    };

    const entries: ModelCatalogEntry[] = [];
    for (const model of json.data ?? []) {
      const id = model.id?.trim();
      if (!id) {
        continue;
      }
      entries.push({
        id,
        name: id,
        provider,
      });
    }

    cache.set(cacheKey, {
      entries,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return entries;
  } catch {
    return [];
  }
}

/**
 * Discover models from all configured providers in the config.
 */
export async function discoverAllModels(cfg: SpecialAgentConfig): Promise<ModelCatalogEntry[]> {
  const providers = cfg.models?.providers ?? {};
  const results: ModelCatalogEntry[] = [];

  const promises = Object.entries(providers).map(async ([key, providerCfg]) => {
    const baseUrl = (providerCfg as { baseUrl?: string })?.baseUrl;
    const api = (providerCfg as { api?: string })?.api;
    const apiKey = (providerCfg as { apiKey?: string })?.apiKey;

    if (!baseUrl) {
      return [];
    }

    return discoverModelsForEndpoint({
      baseUrl,
      api,
      apiKey,
      provider: key,
    });
  });

  const settled = await Promise.allSettled(promises);
  for (const result of settled) {
    if (result.status === "fulfilled") {
      results.push(...result.value);
    }
  }

  return results;
}

/**
 * Clear the discovery cache (useful for testing).
 */
export function clearDiscoveryCache(): void {
  cache.clear();
}
