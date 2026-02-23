/**
 * Cognee HTTP Client
 *
 * Extracted from the memory-cognee plugin for reuse across scoped dataset operations.
 */

import { DEFAULT_DECAY_RATE, type MemoryType } from "./activation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CogneeSearchType = "GRAPH_COMPLETION" | "CHUNKS" | "SUMMARIES";

export type CogneeAddResponse = {
  dataset_id: string;
  dataset_name: string;
  message: string;
  data_id?: unknown;
  data_ingestion_info?: unknown;
};

export type CogneeSearchResult = {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export type CogneePluginConfig = {
  baseUrl?: string;
  apiKey?: string;
  datasetName?: string;
  searchType?: CogneeSearchType;
  maxResults?: number;
  minScore?: number;
  autoRecall?: boolean;
  autoIndex?: boolean;
  autoCognify?: boolean;
  requestTimeoutMs?: number;
  enableTools?: boolean;
  decayRate?: number;
  pruneThreshold?: number;
  autoPrune?: boolean;
  typeWeights?: Partial<Record<MemoryType, number>>;
  consolidationEnabled?: boolean;
  consolidationThreshold?: number;
  consolidationTimeoutMs?: number;
  reflectionEnabled?: boolean;
  reflectionThreshold?: number;
  reflectionTimeoutMs?: number;
  stmMaxAgeDays?: number;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_BASE_URL = "http://localhost:8000";
export const DEFAULT_DATASET_NAME = "special-agent";
export const DEFAULT_SEARCH_TYPE: CogneeSearchType = "GRAPH_COMPLETION";
const VALID_SEARCH_TYPES: readonly CogneeSearchType[] = ["GRAPH_COMPLETION", "CHUNKS", "SUMMARIES"];
export const DEFAULT_MAX_RESULTS = 6;
export const DEFAULT_MIN_SCORE = 0;
export const DEFAULT_AUTO_RECALL = true;
export const DEFAULT_AUTO_INDEX = true;
export const DEFAULT_AUTO_COGNIFY = true;
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_ENABLE_TOOLS = true;
export { DEFAULT_DECAY_RATE } from "./activation.js";
export const DEFAULT_PRUNE_THRESHOLD = 0.05;
export const DEFAULT_AUTO_PRUNE = false;
export const DEFAULT_CONSOLIDATION_ENABLED = false;
export const DEFAULT_CONSOLIDATION_THRESHOLD = 5;
export const DEFAULT_CONSOLIDATION_TIMEOUT_MS = 30_000;
export const DEFAULT_REFLECTION_ENABLED = false;
export const DEFAULT_REFLECTION_THRESHOLD = 15;
export const DEFAULT_REFLECTION_TIMEOUT_MS = 30_000;
export const DEFAULT_STM_MAX_AGE_DAYS = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, envVar: string) => {
    return process.env[envVar] ?? match;
  });
}

export function resolveConfig(rawConfig: unknown): Required<CogneePluginConfig> {
  const raw =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? (rawConfig as CogneePluginConfig)
      : {};

  const baseUrl = raw.baseUrl?.trim() || DEFAULT_BASE_URL;
  const datasetName = raw.datasetName?.trim() || DEFAULT_DATASET_NAME;
  const searchType =
    typeof raw.searchType === "string" &&
    (VALID_SEARCH_TYPES as readonly string[]).includes(raw.searchType)
      ? (raw.searchType as CogneeSearchType)
      : DEFAULT_SEARCH_TYPE;
  const maxResults = typeof raw.maxResults === "number" ? raw.maxResults : DEFAULT_MAX_RESULTS;
  const minScore = typeof raw.minScore === "number" ? raw.minScore : DEFAULT_MIN_SCORE;
  const autoRecall = typeof raw.autoRecall === "boolean" ? raw.autoRecall : DEFAULT_AUTO_RECALL;
  const autoIndex = typeof raw.autoIndex === "boolean" ? raw.autoIndex : DEFAULT_AUTO_INDEX;
  const autoCognify = typeof raw.autoCognify === "boolean" ? raw.autoCognify : DEFAULT_AUTO_COGNIFY;
  const requestTimeoutMs =
    typeof raw.requestTimeoutMs === "number" ? raw.requestTimeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
  const enableTools = typeof raw.enableTools === "boolean" ? raw.enableTools : DEFAULT_ENABLE_TOOLS;
  const decayRate = typeof raw.decayRate === "number" ? raw.decayRate : DEFAULT_DECAY_RATE;
  const pruneThreshold =
    typeof raw.pruneThreshold === "number" ? raw.pruneThreshold : DEFAULT_PRUNE_THRESHOLD;
  const autoPrune = typeof raw.autoPrune === "boolean" ? raw.autoPrune : DEFAULT_AUTO_PRUNE;
  const VALID_MEMORY_TYPES: readonly string[] = ["episodic", "semantic", "procedural", "vault"];
  const rawWeights =
    raw.typeWeights && typeof raw.typeWeights === "object"
      ? (raw.typeWeights as Record<string, number>)
      : {};
  const typeWeights: Partial<Record<MemoryType, number>> = {};
  for (const [k, v] of Object.entries(rawWeights)) {
    if (VALID_MEMORY_TYPES.includes(k) && typeof v === "number") {
      typeWeights[k as MemoryType] = v;
    }
  }
  const consolidationEnabled =
    typeof raw.consolidationEnabled === "boolean"
      ? raw.consolidationEnabled
      : DEFAULT_CONSOLIDATION_ENABLED;
  const consolidationThreshold =
    typeof raw.consolidationThreshold === "number"
      ? raw.consolidationThreshold
      : DEFAULT_CONSOLIDATION_THRESHOLD;
  const consolidationTimeoutMs =
    typeof raw.consolidationTimeoutMs === "number"
      ? raw.consolidationTimeoutMs
      : DEFAULT_CONSOLIDATION_TIMEOUT_MS;
  const reflectionEnabled =
    typeof raw.reflectionEnabled === "boolean" ? raw.reflectionEnabled : DEFAULT_REFLECTION_ENABLED;
  const reflectionThreshold =
    typeof raw.reflectionThreshold === "number"
      ? raw.reflectionThreshold
      : DEFAULT_REFLECTION_THRESHOLD;
  const reflectionTimeoutMs =
    typeof raw.reflectionTimeoutMs === "number"
      ? raw.reflectionTimeoutMs
      : DEFAULT_REFLECTION_TIMEOUT_MS;
  const stmMaxAgeDays =
    typeof raw.stmMaxAgeDays === "number" ? raw.stmMaxAgeDays : DEFAULT_STM_MAX_AGE_DAYS;

  const resolvedApiKey =
    raw.apiKey && raw.apiKey.length > 0 ? resolveEnvVars(raw.apiKey) : undefined;
  const apiKey =
    resolvedApiKey && !resolvedApiKey.includes("${")
      ? resolvedApiKey
      : process.env.COGNEE_API_KEY || "";

  return {
    baseUrl,
    apiKey,
    datasetName,
    searchType,
    maxResults,
    minScore,
    autoRecall,
    autoIndex,
    autoCognify,
    requestTimeoutMs,
    enableTools,
    decayRate,
    pruneThreshold,
    autoPrune,
    typeWeights,
    consolidationEnabled,
    consolidationThreshold,
    consolidationTimeoutMs,
    reflectionEnabled,
    reflectionThreshold,
    reflectionTimeoutMs,
    stmMaxAgeDays,
  };
}

// ---------------------------------------------------------------------------
// HTTP Error
// ---------------------------------------------------------------------------

export class CogneeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CogneeHttpError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class CogneeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  private buildHeaders(): Record<string, string> {
    if (!this.apiKey) return {};
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new CogneeHttpError(
          `Cognee request failed (${response.status}): ${errorText}`,
          response.status,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async add(params: {
    data: string;
    datasetName: string;
    datasetId?: string;
  }): Promise<{ datasetId: string; datasetName: string; dataId?: string }> {
    const formData = new FormData();
    formData.append(
      "data",
      new Blob([params.data], { type: "text/plain" }),
      "special-agent-memory.txt",
    );
    formData.append("datasetName", params.datasetName);
    if (params.datasetId) {
      formData.append("datasetId", params.datasetId);
    }

    const data = await this.fetchJson<CogneeAddResponse>("/api/v1/add", {
      method: "POST",
      headers: this.buildHeaders(),
      body: formData,
    });

    const dataId = this.extractDataId(data.data_id ?? data.data_ingestion_info);

    return {
      datasetId: data.dataset_id,
      datasetName: data.dataset_name,
      dataId,
    };
  }

  async update(params: {
    dataId: string;
    datasetId: string;
    data: string;
  }): Promise<{ datasetId: string; datasetName: string; dataId?: string }> {
    const query = new URLSearchParams({
      data_id: params.dataId,
      dataset_id: params.datasetId,
    });

    const formData = new FormData();
    formData.append(
      "data",
      new Blob([params.data], { type: "text/plain" }),
      "special-agent-memory.txt",
    );

    const data = await this.fetchJson<CogneeAddResponse>(`/api/v1/update?${query.toString()}`, {
      method: "PATCH",
      headers: this.buildHeaders(),
      body: formData,
    });

    return {
      datasetId: data.dataset_id,
      datasetName: data.dataset_name,
      dataId: this.extractDataId(data.data_id ?? data.data_ingestion_info),
    };
  }

  async cognify(params: { datasetIds?: string[] } = {}): Promise<{ status?: string }> {
    return this.fetchJson<{ status?: string }>("/api/v1/cognify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.buildHeaders(),
      },
      body: JSON.stringify({ datasetIds: params.datasetIds }),
    });
  }

  async delete(params: { dataId: string; datasetId: string }): Promise<void> {
    const query = new URLSearchParams({
      data_id: params.dataId,
      dataset_id: params.datasetId,
    });
    await this.fetchJson<unknown>(`/api/v1/delete?${query.toString()}`, {
      method: "DELETE",
      headers: this.buildHeaders(),
    });
  }

  async search(params: {
    queryText: string;
    searchType: CogneeSearchType;
    datasetIds: string[];
    topK: number;
  }): Promise<CogneeSearchResult[]> {
    const data = await this.fetchJson<unknown>("/api/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.buildHeaders(),
      },
      body: JSON.stringify({
        query: params.queryText,
        searchType: params.searchType,
        datasetIds: params.datasetIds,
        topK: params.topK,
      }),
    });

    return this.normalizeSearchResults(data);
  }

  /**
   * Normalize Cognee search response to consistent format.
   * Cognee returns a direct array of strings: ["answer text here"]
   * We convert to: [{ id, text, score }]
   */
  private normalizeSearchResults(data: unknown, depth: number = 0): CogneeSearchResult[] {
    if (Array.isArray(data)) {
      return data.map((item, index) => {
        if (typeof item === "string") {
          return { id: `result-${index}`, text: item, score: 1 };
        }
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return {
            id: typeof record.id === "string" ? record.id : `result-${index}`,
            text: typeof record.text === "string" ? record.text : JSON.stringify(record),
            score: typeof record.score === "number" ? record.score : 1,
            metadata: record.metadata as Record<string, unknown> | undefined,
          };
        }
        return { id: `result-${index}`, text: String(item), score: 1 };
      });
    }

    if (depth < 1 && data && typeof data === "object" && "results" in data) {
      return this.normalizeSearchResults((data as { results: unknown }).results, depth + 1);
    }

    return [];
  }

  private extractDataId(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const id = this.extractDataId(entry);
        if (id) return id;
      }
      return undefined;
    }
    if (typeof value !== "object") return undefined;
    const record = value as { data_id?: unknown; data_ingestion_info?: unknown };
    if (typeof record.data_id === "string") return record.data_id;
    return this.extractDataId(record.data_ingestion_info);
  }
}
