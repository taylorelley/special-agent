import type { SpecialAgentConfig } from "../../config/config.js";
import { type ModelRef, normalizeProviderId } from "../../agents/model-selection.js";

export type ModelPickerCatalogEntry = {
  provider: string;
  id: string;
  name?: string;
};

export type ModelPickerItem = ModelRef;

export function buildModelPickerItems(catalog: ModelPickerCatalogEntry[]): ModelPickerItem[] {
  const seen = new Set<string>();
  const out: ModelPickerItem[] = [];

  for (const entry of catalog) {
    const provider = normalizeProviderId(entry.provider);
    const model = entry.id?.trim();
    if (!provider || !model) {
      continue;
    }

    const key = `${provider}/${model}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    out.push({ model, provider });
  }

  // Sort alphabetically by provider, then by model name
  out.sort((a, b) => {
    const providerOrder = a.provider.localeCompare(b.provider);
    if (providerOrder !== 0) {
      return providerOrder;
    }
    return a.model.toLowerCase().localeCompare(b.model.toLowerCase());
  });

  return out;
}

export function resolveProviderEndpointLabel(
  provider: string,
  cfg: SpecialAgentConfig,
): { endpoint?: string; api?: string } {
  const normalized = normalizeProviderId(provider);
  const providers = (cfg.models?.providers ?? {}) as Record<
    string,
    { baseUrl?: string; api?: string } | undefined
  >;
  const entry = providers[normalized];
  const endpoint = entry?.baseUrl?.trim();
  const api = entry?.api?.trim();
  return {
    endpoint: endpoint || undefined,
    api: api || undefined,
  };
}
