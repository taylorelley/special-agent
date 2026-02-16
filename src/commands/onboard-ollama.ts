import type { SpecialAgentConfig } from "../config/config.js";
import type { ModelDefinitionConfig } from "../config/types.models.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";

export const OLLAMA_PROVIDER_ID = "ollama";
export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const OLLAMA_DEFAULT_CONTEXT_WINDOW = 32_768;
const OLLAMA_DEFAULT_MAX_TOKENS = 4096;
const PROBE_TIMEOUT_MS = 5000;

export async function probeOllamaRunning(
  baseUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  // Try OpenAI-compat /v1/models first
  const modelsUrl = new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
  try {
    const res = await fetchWithTimeout(modelsUrl, { method: "GET" }, PROBE_TIMEOUT_MS);
    if (res.ok) {
      return { ok: true };
    }
  } catch {
    // fall through to native endpoint
  }

  // Fallback: try Ollama native /api/tags
  try {
    const parsed = new URL(baseUrl);
    const nativeUrl = `${parsed.protocol}//${parsed.host}/api/tags`;
    const res = await fetchWithTimeout(nativeUrl, { method: "GET" }, PROBE_TIMEOUT_MS);
    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

export async function fetchOllamaContextWindow(
  baseUrl: string,
  modelId: string,
): Promise<number | undefined> {
  try {
    const parsed = new URL(baseUrl);
    // Strip /v1 suffix to get native Ollama host
    const host = `${parsed.protocol}//${parsed.host}`;
    const showUrl = `${host}/api/show`;
    const res = await fetchWithTimeout(
      showUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelId }),
      },
      PROBE_TIMEOUT_MS,
    );
    if (!res.ok) {
      return undefined;
    }
    const data = (await res.json()) as {
      model_info?: Record<string, unknown>;
    };
    if (!data.model_info) {
      return undefined;
    }
    for (const [key, value] of Object.entries(data.model_info)) {
      if (key.endsWith(".context_length") && typeof value === "number" && value > 0) {
        return value;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function buildOllamaModelDefinition(
  modelId: string,
  contextWindow?: number,
): ModelDefinitionConfig {
  return {
    id: modelId,
    name: `${modelId} (Ollama)`,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? OLLAMA_DEFAULT_CONTEXT_WINDOW,
    maxTokens: OLLAMA_DEFAULT_MAX_TOKENS,
  };
}

export function applyOllamaProviderConfig(
  cfg: SpecialAgentConfig,
  params: {
    baseUrl: string;
    apiKey?: string;
    models: ModelDefinitionConfig[];
  },
): SpecialAgentConfig {
  return {
    ...cfg,
    models: {
      ...cfg.models,
      mode: cfg.models?.mode ?? "merge",
      providers: {
        ...cfg.models?.providers,
        [OLLAMA_PROVIDER_ID]: {
          baseUrl: params.baseUrl,
          api: "openai-completions" as const,
          ...(params.apiKey ? { apiKey: params.apiKey } : {}),
          models: params.models,
        },
      },
    },
  };
}
