import type { SpecialAgentConfig } from "../config/config.js";
import type { WizardPrompter, WizardSelectOption } from "../wizard/prompts.js";
import { ensureAuthProfileStore, listProfilesForProvider } from "../agents/auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { getCustomProviderApiKey, resolveEnvApiKey } from "../agents/model-auth.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import {
  buildAllowedModelSet,
  buildModelAliasIndex,
  modelKey,
  resolveConfiguredModelRef,
} from "../agents/model-selection.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { formatTokenK } from "./models/shared.js";
import { OPENAI_CODEX_DEFAULT_MODEL } from "./openai-codex-model-default.js";

const KEEP_VALUE = "__keep__";
const MANUAL_VALUE = "__manual__";

// Models that are internal routing features and should not be shown in selection lists.
// These may be valid as defaults (e.g., set automatically during auth flow) but are not
// directly callable via API and would cause "Unknown model" errors if selected manually.
const HIDDEN_ROUTER_MODELS = new Set(["openrouter/auto"]);

type PromptDefaultModelParams = {
  config: SpecialAgentConfig;
  prompter: WizardPrompter;
  allowKeep?: boolean;
  includeManual?: boolean;
  ignoreAllowlist?: boolean;
  preferredProvider?: string;
  agentDir?: string;
  message?: string;
  endpointBaseUrl?: string;
  endpointApiKey?: string;
};

type PromptDefaultModelResult = { model?: string };
type PromptModelAllowlistResult = { models?: string[] };

function hasAuthForProvider(
  provider: string,
  cfg: SpecialAgentConfig,
  store: ReturnType<typeof ensureAuthProfileStore>,
) {
  if (listProfilesForProvider(store, provider).length > 0) {
    return true;
  }
  if (resolveEnvApiKey(provider)) {
    return true;
  }
  if (getCustomProviderApiKey(cfg, provider)) {
    return true;
  }
  return false;
}

function resolveConfiguredModelRaw(cfg: SpecialAgentConfig): string {
  const raw = cfg.agents?.defaults?.model as { primary?: string } | string | undefined;
  if (typeof raw === "string") {
    return raw.trim();
  }
  return raw?.primary?.trim() ?? "";
}

function resolveConfiguredModelKeys(cfg: SpecialAgentConfig): string[] {
  const models = cfg.agents?.defaults?.models ?? {};
  return Object.keys(models)
    .map((key) => String(key ?? "").trim())
    .filter((key) => key.length > 0);
}

function normalizeModelKeys(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    next.push(value);
  }
  return next;
}

async function promptManualModel(params: {
  prompter: WizardPrompter;
  allowBlank: boolean;
  initialValue?: string;
}): Promise<PromptDefaultModelResult> {
  const modelInput = await params.prompter.text({
    message: params.allowBlank ? "Default model (blank to keep)" : "Default model",
    initialValue: params.initialValue,
    placeholder: "provider/model",
    validate: params.allowBlank ? undefined : (value) => (value?.trim() ? undefined : "Required"),
  });
  const model = String(modelInput ?? "").trim();
  if (!model) {
    return {};
  }
  return { model };
}

const FETCH_MODELS_TIMEOUT_MS = 10_000;

export async function fetchEndpointModels(
  baseUrl: string,
  apiKey: string,
): Promise<{ id: string; name?: string }[]> {
  const url = new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const res = await fetchWithTimeout(url, { method: "GET", headers }, FETCH_MODELS_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`Failed to fetch models: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    data?: { id: string; name?: string }[];
    models?: { name?: string; model?: string }[];
  };
  // OpenAI-style: { data: [{ id, ... }] }
  if (Array.isArray(body.data)) {
    return body.data.map((m) => ({ id: m.id, name: m.name }));
  }
  // Ollama-style: { models: [{ name, model, ... }] }
  if (Array.isArray(body.models)) {
    return body.models.map((m) => ({ id: m.model ?? m.name ?? "unknown", name: m.name }));
  }
  return [];
}

export async function promptDefaultModel(
  params: PromptDefaultModelParams,
): Promise<PromptDefaultModelResult> {
  const cfg = params.config;
  const allowKeep = params.allowKeep ?? true;
  const includeManual = params.includeManual ?? true;
  const ignoreAllowlist = params.ignoreAllowlist ?? false;
  const configuredRaw = resolveConfiguredModelRaw(cfg);

  const resolved = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const resolvedKey = modelKey(resolved.provider, resolved.model);
  const configuredKey = configuredRaw ? resolvedKey : "";

  // When an endpoint URL is provided, fetch models from the endpoint instead of the catalog.
  if (params.endpointBaseUrl) {
    const progress = params.prompter.progress("Fetching models from endpoint...");
    let endpointModels: { id: string; name?: string }[] = [];
    try {
      endpointModels = await fetchEndpointModels(
        params.endpointBaseUrl,
        params.endpointApiKey ?? "",
      );
      progress.stop(
        `Found ${endpointModels.length} model${endpointModels.length === 1 ? "" : "s"}.`,
      );
    } catch {
      progress.stop("Failed to fetch models from endpoint.");
      return promptManualModel({
        prompter: params.prompter,
        allowBlank: allowKeep,
        initialValue: configuredRaw || resolvedKey || undefined,
      });
    }

    if (endpointModels.length === 0) {
      return promptManualModel({
        prompter: params.prompter,
        allowBlank: allowKeep,
        initialValue: configuredRaw || resolvedKey || undefined,
      });
    }

    const options: WizardSelectOption[] = [];
    if (allowKeep) {
      options.push({
        value: KEEP_VALUE,
        label: configuredRaw
          ? `Keep current (${configuredRaw})`
          : `Keep current (default: ${resolvedKey})`,
      });
    }
    if (includeManual) {
      options.push({ value: MANUAL_VALUE, label: "Enter model manually" });
    }
    for (const m of endpointModels) {
      const hint = m.name && m.name !== m.id ? m.name : undefined;
      options.push({ value: m.id, label: m.id, hint });
    }

    const selection = await params.prompter.select({
      message: params.message ?? "Default model",
      options,
      initialValue: allowKeep ? KEEP_VALUE : undefined,
    });

    if (selection === KEEP_VALUE) {
      return {};
    }
    if (selection === MANUAL_VALUE) {
      return promptManualModel({
        prompter: params.prompter,
        allowBlank: false,
        initialValue: configuredRaw || resolvedKey || undefined,
      });
    }
    return { model: String(selection) };
  }

  const catalog = await loadModelCatalog({ config: cfg, useCache: false });
  if (catalog.length === 0) {
    return promptManualModel({
      prompter: params.prompter,
      allowBlank: allowKeep,
      initialValue: configuredRaw || resolvedKey || undefined,
    });
  }

  const aliasIndex = buildModelAliasIndex({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
  });
  let models = catalog;
  if (!ignoreAllowlist) {
    const { allowedCatalog } = buildAllowedModelSet({
      cfg,
      catalog,
      defaultProvider: DEFAULT_PROVIDER,
    });
    models = allowedCatalog.length > 0 ? allowedCatalog : catalog;
  }

  if (models.length === 0) {
    return promptManualModel({
      prompter: params.prompter,
      allowBlank: allowKeep,
      initialValue: configuredRaw || resolvedKey || undefined,
    });
  }

  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });
  const authCache = new Map<string, boolean>();
  const hasAuth = (provider: string) => {
    const cached = authCache.get(provider);
    if (cached !== undefined) {
      return cached;
    }
    const value = hasAuthForProvider(provider, cfg, authStore);
    authCache.set(provider, value);
    return value;
  };

  const options: WizardSelectOption[] = [];
  if (allowKeep) {
    options.push({
      value: KEEP_VALUE,
      label: configuredRaw
        ? `Keep current (${configuredRaw})`
        : `Keep current (default: ${resolvedKey})`,
      hint:
        configuredRaw && configuredRaw !== resolvedKey ? `resolves to ${resolvedKey}` : undefined,
    });
  }
  if (includeManual) {
    options.push({ value: MANUAL_VALUE, label: "Enter model manually" });
  }

  const seen = new Set<string>();
  const addModelOption = (entry: {
    provider: string;
    id: string;
    name?: string;
    contextWindow?: number;
    reasoning?: boolean;
  }) => {
    const key = modelKey(entry.provider, entry.id);
    if (seen.has(key)) {
      return;
    }
    // Skip internal router models that can't be directly called via API.
    if (HIDDEN_ROUTER_MODELS.has(key)) {
      return;
    }
    const hints: string[] = [];
    if (entry.name && entry.name !== entry.id) {
      hints.push(entry.name);
    }
    if (entry.contextWindow) {
      hints.push(`ctx ${formatTokenK(entry.contextWindow)}`);
    }
    if (entry.reasoning) {
      hints.push("reasoning");
    }
    const aliases = aliasIndex.byKey.get(key);
    if (aliases?.length) {
      hints.push(`alias: ${aliases.join(", ")}`);
    }
    if (!hasAuth(entry.provider)) {
      hints.push("auth missing");
    }
    options.push({
      value: key,
      label: key,
      hint: hints.length > 0 ? hints.join(" · ") : undefined,
    });
    seen.add(key);
  };

  for (const entry of models) {
    addModelOption(entry);
  }

  if (configuredKey && !seen.has(configuredKey)) {
    options.push({
      value: configuredKey,
      label: configuredKey,
      hint: "current (not in catalog)",
    });
  }

  const initialValue: string | undefined = allowKeep ? KEEP_VALUE : configuredKey || undefined;

  const selection = await params.prompter.select({
    message: params.message ?? "Default model",
    options,
    initialValue,
  });

  if (selection === KEEP_VALUE) {
    return {};
  }
  if (selection === MANUAL_VALUE) {
    return promptManualModel({
      prompter: params.prompter,
      allowBlank: false,
      initialValue: configuredRaw || resolvedKey || undefined,
    });
  }
  return { model: String(selection) };
}

export async function promptModelAllowlist(params: {
  config: SpecialAgentConfig;
  prompter: WizardPrompter;
  message?: string;
  agentDir?: string;
  allowedKeys?: string[];
  initialSelections?: string[];
}): Promise<PromptModelAllowlistResult> {
  const cfg = params.config;
  const existingKeys = resolveConfiguredModelKeys(cfg);
  const allowedKeys = normalizeModelKeys(params.allowedKeys ?? []);
  const allowedKeySet = allowedKeys.length > 0 ? new Set(allowedKeys) : null;
  const resolved = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const resolvedKey = modelKey(resolved.provider, resolved.model);
  const initialSeeds = normalizeModelKeys([
    ...existingKeys,
    resolvedKey,
    ...(params.initialSelections ?? []),
  ]);
  const initialKeys = allowedKeySet
    ? initialSeeds.filter((key) => allowedKeySet.has(key))
    : initialSeeds;

  const catalog = await loadModelCatalog({ config: cfg, useCache: false });
  if (catalog.length === 0 && allowedKeys.length === 0) {
    const raw = await params.prompter.text({
      message:
        params.message ??
        "Allowlist models (comma-separated provider/model; blank to keep current)",
      initialValue: existingKeys.join(", "),
      placeholder: `${OPENAI_CODEX_DEFAULT_MODEL}, anthropic/claude-opus-4-6`,
    });
    const parsed = String(raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (parsed.length === 0) {
      return {};
    }
    return { models: normalizeModelKeys(parsed) };
  }

  const aliasIndex = buildModelAliasIndex({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
  });
  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });
  const authCache = new Map<string, boolean>();
  const hasAuth = (provider: string) => {
    const cached = authCache.get(provider);
    if (cached !== undefined) {
      return cached;
    }
    const value = hasAuthForProvider(provider, cfg, authStore);
    authCache.set(provider, value);
    return value;
  };

  const options: WizardSelectOption[] = [];
  const seen = new Set<string>();
  const addModelOption = (entry: {
    provider: string;
    id: string;
    name?: string;
    contextWindow?: number;
    reasoning?: boolean;
  }) => {
    const key = modelKey(entry.provider, entry.id);
    if (seen.has(key)) {
      return;
    }
    if (HIDDEN_ROUTER_MODELS.has(key)) {
      return;
    }
    const hints: string[] = [];
    if (entry.name && entry.name !== entry.id) {
      hints.push(entry.name);
    }
    if (entry.contextWindow) {
      hints.push(`ctx ${formatTokenK(entry.contextWindow)}`);
    }
    if (entry.reasoning) {
      hints.push("reasoning");
    }
    const aliases = aliasIndex.byKey.get(key);
    if (aliases?.length) {
      hints.push(`alias: ${aliases.join(", ")}`);
    }
    if (!hasAuth(entry.provider)) {
      hints.push("auth missing");
    }
    options.push({
      value: key,
      label: key,
      hint: hints.length > 0 ? hints.join(" · ") : undefined,
    });
    seen.add(key);
  };

  const filteredCatalog = allowedKeySet
    ? catalog.filter((entry) => allowedKeySet.has(modelKey(entry.provider, entry.id)))
    : catalog;

  for (const entry of filteredCatalog) {
    addModelOption(entry);
  }

  const supplementalKeys = allowedKeySet ? allowedKeys : existingKeys;
  for (const key of supplementalKeys) {
    if (seen.has(key)) {
      continue;
    }
    options.push({
      value: key,
      label: key,
      hint: allowedKeySet ? "allowed (not in catalog)" : "configured (not in catalog)",
    });
    seen.add(key);
  }

  if (options.length === 0) {
    return {};
  }

  const selection = await params.prompter.multiselect({
    message: params.message ?? "Models in /model picker (multi-select)",
    options,
    initialValues: initialKeys.length > 0 ? initialKeys : undefined,
  });
  const selected = normalizeModelKeys(selection.map((value) => String(value)));
  if (selected.length > 0) {
    return { models: selected };
  }
  if (existingKeys.length === 0) {
    return { models: [] };
  }
  const confirmClear = await params.prompter.confirm({
    message: "Clear the model allowlist? (shows all models)",
    initialValue: false,
  });
  if (!confirmClear) {
    return {};
  }
  return { models: [] };
}

export function applyPrimaryModel(cfg: SpecialAgentConfig, model: string): SpecialAgentConfig {
  const defaults = cfg.agents?.defaults;
  const existingModel = defaults?.model;
  const existingModels = defaults?.models;
  const fallbacks =
    typeof existingModel === "object" && existingModel !== null && "fallbacks" in existingModel
      ? (existingModel as { fallbacks?: string[] }).fallbacks
      : undefined;
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...defaults,
        model: {
          ...(fallbacks ? { fallbacks } : undefined),
          primary: model,
        },
        models: {
          ...existingModels,
          [model]: existingModels?.[model] ?? {},
        },
      },
    },
  };
}

export function applyModelAllowlist(cfg: SpecialAgentConfig, models: string[]): SpecialAgentConfig {
  const defaults = cfg.agents?.defaults;
  const normalized = normalizeModelKeys(models);
  if (normalized.length === 0) {
    if (!defaults?.models) {
      return cfg;
    }
    const { models: _ignored, ...restDefaults } = defaults;
    return {
      ...cfg,
      agents: {
        ...cfg.agents,
        defaults: restDefaults,
      },
    };
  }

  const existingModels = defaults?.models ?? {};
  const nextModels: Record<string, { alias?: string }> = {};
  for (const key of normalized) {
    nextModels[key] = existingModels[key] ?? {};
  }

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...defaults,
        models: nextModels,
      },
    },
  };
}

export function applyModelFallbacksFromSelection(
  cfg: SpecialAgentConfig,
  selection: string[],
): SpecialAgentConfig {
  const normalized = normalizeModelKeys(selection);
  if (normalized.length <= 1) {
    return cfg;
  }

  const resolved = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const resolvedKey = modelKey(resolved.provider, resolved.model);
  if (!normalized.includes(resolvedKey)) {
    return cfg;
  }

  const defaults = cfg.agents?.defaults;
  const existingModel = defaults?.model;
  const existingPrimary =
    typeof existingModel === "string"
      ? existingModel
      : existingModel && typeof existingModel === "object"
        ? existingModel.primary
        : undefined;

  const fallbacks = normalized.filter((key) => key !== resolvedKey);
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...defaults,
        model: {
          ...(typeof existingModel === "object" ? existingModel : undefined),
          primary: existingPrimary ?? resolvedKey,
          fallbacks,
        },
      },
    },
  };
}
