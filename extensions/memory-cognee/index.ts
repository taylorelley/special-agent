/**
 * SpecialAgent Memory (Cognee) Plugin
 *
 * Cognee-backed memory: indexes workspace memory files into a knowledge graph,
 * auto-recalls relevant memories before agent runs, and auto-syncs file changes
 * after each agent turn.
 *
 * Adapted from the official cognee-integrations/openclaw plugin:
 * https://github.com/topoteretes/cognee-integrations/tree/main/integrations/openclaw
 */

import type { SpecialAgentPluginApi } from "special-agent/plugin-sdk";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { hashText } from "../../src/memory/internal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CogneeSearchType = "GRAPH_COMPLETION" | "CHUNKS" | "SUMMARIES";

type CogneePluginConfig = {
  baseUrl?: string;
  apiKey?: string;
  datasetName?: string;
  searchType?: CogneeSearchType;
  maxResults?: number;
  minScore?: number;
  maxTokens?: number;
  autoRecall?: boolean;
  autoIndex?: boolean;
  autoCognify?: boolean;
  requestTimeoutMs?: number;
};

type CogneeAddResponse = {
  dataset_id: string;
  dataset_name: string;
  message: string;
  data_id?: unknown;
  data_ingestion_info?: unknown;
};

type CogneeSearchResult = {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
};

type DatasetState = Record<string, string>;

type SyncIndex = {
  datasetId?: string;
  datasetName?: string;
  entries: Record<string, { hash: string; dataId?: string }>;
};

type MemoryFile = {
  /** Relative path from workspace root (e.g. "MEMORY.md", "memory/tools.md") */
  path: string;
  /** Absolute path on disk */
  absPath: string;
  /** File content */
  content: string;
  /** SHA-256 hex hash of content */
  hash: string;
};

type SyncResult = {
  added: number;
  updated: number;
  skipped: number;
  errors: number;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "http://localhost:8000";
const DEFAULT_DATASET_NAME = "special-agent";
const DEFAULT_SEARCH_TYPE: CogneeSearchType = "GRAPH_COMPLETION";
const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MIN_SCORE = 0;
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_AUTO_RECALL = true;
const DEFAULT_AUTO_INDEX = true;
const DEFAULT_AUTO_COGNIFY = true;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

const STATE_PATH = join(homedir(), ".special-agent", "memory", "cognee", "datasets.json");
const SYNC_INDEX_PATH = join(homedir(), ".special-agent", "memory", "cognee", "sync-index.json");

/** Glob patterns for memory files, relative to workspace root. */
const MEMORY_FILE_PATTERNS = ["MEMORY.md", "memory.md", "memory"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar: string) => {
    return process.env[envVar] ?? "";
  });
}

function resolveConfig(rawConfig: unknown): Required<CogneePluginConfig> {
  const raw =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? (rawConfig as CogneePluginConfig)
      : {};

  const baseUrl = raw.baseUrl?.trim() || DEFAULT_BASE_URL;
  const datasetName = raw.datasetName?.trim() || DEFAULT_DATASET_NAME;
  const searchType = raw.searchType || DEFAULT_SEARCH_TYPE;
  const maxResults = typeof raw.maxResults === "number" ? raw.maxResults : DEFAULT_MAX_RESULTS;
  const minScore = typeof raw.minScore === "number" ? raw.minScore : DEFAULT_MIN_SCORE;
  const maxTokens = typeof raw.maxTokens === "number" ? raw.maxTokens : DEFAULT_MAX_TOKENS;
  const autoRecall = typeof raw.autoRecall === "boolean" ? raw.autoRecall : DEFAULT_AUTO_RECALL;
  const autoIndex = typeof raw.autoIndex === "boolean" ? raw.autoIndex : DEFAULT_AUTO_INDEX;
  const autoCognify = typeof raw.autoCognify === "boolean" ? raw.autoCognify : DEFAULT_AUTO_COGNIFY;
  const requestTimeoutMs =
    typeof raw.requestTimeoutMs === "number" ? raw.requestTimeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;

  const apiKey =
    raw.apiKey && raw.apiKey.length > 0
      ? resolveEnvVars(raw.apiKey)
      : process.env.COGNEE_API_KEY || "";

  return {
    baseUrl,
    apiKey,
    datasetName,
    searchType,
    maxResults,
    minScore,
    maxTokens,
    autoRecall,
    autoIndex,
    autoCognify,
    requestTimeoutMs,
  };
}

// ---------------------------------------------------------------------------
// Persistence — dataset state & sync index
// ---------------------------------------------------------------------------

async function loadDatasetState(): Promise<DatasetState> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as DatasetState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function saveDatasetState(state: DatasetState): Promise<void> {
  await fs.mkdir(dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

async function loadSyncIndex(): Promise<SyncIndex> {
  try {
    const raw = await fs.readFile(SYNC_INDEX_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { entries: {} };
    }
    const record = parsed as SyncIndex;
    record.entries ??= {};
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { entries: {} };
    }
    throw error;
  }
}

async function saveSyncIndex(state: SyncIndex): Promise<void> {
  await fs.mkdir(dirname(SYNC_INDEX_PATH), { recursive: true });
  await fs.writeFile(SYNC_INDEX_PATH, JSON.stringify(state, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// File collection — scan workspace for memory markdown files
// ---------------------------------------------------------------------------

async function collectMemoryFiles(workspaceDir: string): Promise<MemoryFile[]> {
  const files: MemoryFile[] = [];
  const seen = new Set<string>();

  for (const pattern of MEMORY_FILE_PATTERNS) {
    const target = resolve(workspaceDir, pattern);

    try {
      const stat = await fs.stat(target);

      if (stat.isFile() && target.endsWith(".md")) {
        const realTarget = await fs.realpath(target);
        if (seen.has(realTarget)) continue;
        seen.add(realTarget);

        const content = await fs.readFile(target, "utf-8");
        files.push({
          path: relative(workspaceDir, target),
          absPath: target,
          content,
          hash: hashText(content),
        });
      } else if (stat.isDirectory()) {
        const entries = await scanDir(target, workspaceDir, seen);
        files.push(...entries);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  return files;
}

async function scanDir(
  dir: string,
  workspaceDir: string,
  seen: Set<string> = new Set(),
): Promise<MemoryFile[]> {
  const realDir = await fs.realpath(dir);
  if (seen.has(realDir)) return [];
  seen.add(realDir);

  const files: MemoryFile[] = [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await scanDir(absPath, workspaceDir, seen);
      files.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const realFile = await fs.realpath(absPath);
      if (seen.has(realFile)) continue;
      seen.add(realFile);

      const content = await fs.readFile(absPath, "utf-8");
      files.push({
        path: relative(workspaceDir, absPath),
        absPath,
        content,
        hash: hashText(content),
      });
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Cognee HTTP client
// ---------------------------------------------------------------------------

class CogneeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CogneeHttpError";
  }
}

class CogneeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly timeoutMs: number = 30_000,
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

  async search(params: {
    queryText: string;
    searchType: CogneeSearchType;
    datasetIds: string[];
    maxTokens: number;
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
        max_tokens: params.maxTokens,
      }),
    });

    return this.normalizeSearchResults(data);
  }

  /**
   * Normalize Cognee search response to consistent format.
   * Cognee returns a direct array of strings: ["answer text here"]
   * We convert to: [{ id, text, score }]
   */
  private normalizeSearchResults(data: unknown): CogneeSearchResult[] {
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

    if (data && typeof data === "object" && "results" in data) {
      return this.normalizeSearchResults((data as { results: unknown }).results);
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

// ---------------------------------------------------------------------------
// Unified sync logic
//
// For each memory file:
//   - New file (no sync index entry)        → add + cognify
//   - Changed file with dataId              → update (no re-cognify)
//   - Changed file without dataId           → add + cognify
//   - Unchanged file                        → skip
// ---------------------------------------------------------------------------

async function syncFiles(
  client: CogneeClient,
  files: MemoryFile[],
  syncIndex: SyncIndex,
  cfg: Required<CogneePluginConfig>,
  logger: { info?: (msg: string) => void; warn?: (msg: string) => void },
): Promise<SyncResult & { datasetId?: string }> {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: 0 };
  let datasetId = syncIndex.datasetId;
  let needsCognify = false;

  for (const file of files) {
    const existing = syncIndex.entries[file.path];

    if (existing && existing.hash === file.hash) {
      result.skipped++;
      continue;
    }

    const dataWithMetadata = `# ${file.path}\n\n${file.content}\n\n---\nMetadata: ${JSON.stringify({ path: file.path, source: "memory" })}`;

    try {
      if (existing?.dataId && datasetId) {
        try {
          await client.update({
            dataId: existing.dataId,
            datasetId,
            data: dataWithMetadata,
          });

          syncIndex.entries[file.path] = { hash: file.hash, dataId: existing.dataId };
          syncIndex.datasetId = datasetId;
          syncIndex.datasetName = cfg.datasetName;
          result.updated++;

          logger.info?.(`memory-cognee: updated ${file.path}`);
          continue;
        } catch (updateError) {
          const isRecoverable =
            (updateError instanceof CogneeHttpError &&
              (updateError.status === 404 || updateError.status === 409)) ||
            (updateError instanceof Error &&
              (updateError.message.includes("not found") ||
                updateError.message.includes("404") ||
                updateError.message.includes("409")));
          if (isRecoverable) {
            logger.info?.(`memory-cognee: update failed for ${file.path}, falling back to add`);
            delete existing.dataId;
          } else {
            throw updateError;
          }
        }
      }

      const response = await client.add({
        data: dataWithMetadata,
        datasetName: cfg.datasetName,
        datasetId,
      });

      if (response.datasetId && response.datasetId !== datasetId) {
        datasetId = response.datasetId;

        const state = await loadDatasetState();
        state[cfg.datasetName] = response.datasetId;
        await saveDatasetState(state);
      }

      syncIndex.entries[file.path] = {
        hash: file.hash,
        dataId: response.dataId,
      };
      syncIndex.datasetId = datasetId;
      syncIndex.datasetName = cfg.datasetName;
      needsCognify = true;
      result.added++;

      logger.info?.(`memory-cognee: added ${file.path}`);
    } catch (error) {
      result.errors++;
      logger.warn?.(
        `memory-cognee: failed to sync ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (needsCognify && cfg.autoCognify && datasetId) {
    try {
      await client.cognify({ datasetIds: [datasetId] });
      logger.info?.("memory-cognee: cognify completed");
    } catch (error) {
      logger.warn?.(
        `memory-cognee: cognify failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await saveSyncIndex(syncIndex);

  return { ...result, datasetId };
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

const memoryCogneePlugin = {
  id: "memory-cognee",
  name: "Memory (Cognee)",
  description:
    "Cognee-backed memory: indexes workspace memory files, auto-recalls before agent runs",
  kind: "memory" as const,
  register(api: SpecialAgentPluginApi) {
    const cfg = resolveConfig(api.pluginConfig);
    const client = new CogneeClient(cfg.baseUrl, cfg.apiKey, cfg.requestTimeoutMs);
    let datasetId: string | undefined;
    let syncIndex: SyncIndex = { entries: {} };
    let resolvedWorkspaceDir: string | undefined;

    const stateReady = Promise.all([
      loadDatasetState()
        .then((state) => {
          if (state[cfg.datasetName]) {
            datasetId = state[cfg.datasetName];
          }
        })
        .catch((error) => {
          api.logger.warn?.(`memory-cognee: failed to load dataset state: ${String(error)}`);
        }),
      loadSyncIndex()
        .then((state) => {
          syncIndex = state;
          if (!datasetId && state.datasetId && state.datasetName === cfg.datasetName) {
            datasetId = state.datasetId;
          }
        })
        .catch((error) => {
          api.logger.warn?.(`memory-cognee: failed to load sync index: ${String(error)}`);
        }),
    ]);

    async function runSync(
      workspaceDir: string,
      logger: { info?: (msg: string) => void; warn?: (msg: string) => void },
    ) {
      await stateReady;

      const files = await collectMemoryFiles(workspaceDir);
      if (files.length === 0) {
        logger.info?.("memory-cognee: no memory files found");
        return { added: 0, updated: 0, skipped: 0, errors: 0 };
      }

      logger.info?.(`memory-cognee: found ${files.length} memory file(s), syncing...`);

      const result = await syncFiles(client, files, syncIndex, cfg, logger);
      if (result.datasetId) {
        datasetId = result.datasetId;
      }

      return result;
    }

    // ------------------------------------------------------------------
    // CLI: special-agent cognee index / special-agent cognee status
    // ------------------------------------------------------------------

    api.registerCli(
      (ctx) => {
        const cognee = ctx.program.command("cognee").description("Cognee memory management");
        const cliWorkspaceDir = ctx.workspaceDir || process.cwd();

        cognee
          .command("index")
          .description("Sync memory files to Cognee (add new, update changed, skip unchanged)")
          .action(async () => {
            const result = await runSync(cliWorkspaceDir, ctx.logger);
            const summary = `Sync complete: ${result.added} added, ${result.updated} updated, ${result.skipped} unchanged, ${result.errors} errors`;
            ctx.logger.info?.(summary);
            console.log(summary);
          });

        cognee
          .command("status")
          .description("Show Cognee sync state (files indexed, dataset info)")
          .action(async () => {
            await stateReady;

            const entryCount = Object.keys(syncIndex.entries).length;
            const entriesWithDataId = Object.values(syncIndex.entries).filter(
              (e) => e.dataId,
            ).length;
            const files = await collectMemoryFiles(cliWorkspaceDir);

            let dirty = 0;
            let newCount = 0;
            for (const file of files) {
              const existing = syncIndex.entries[file.path];
              if (!existing) {
                newCount++;
              } else if (existing.hash !== file.hash) {
                dirty++;
              }
            }

            const lines = [
              `Dataset: ${syncIndex.datasetName ?? cfg.datasetName}`,
              `Dataset ID: ${datasetId ?? syncIndex.datasetId ?? "(not set)"}`,
              `Indexed files: ${entryCount} (${entriesWithDataId} with data ID)`,
              `Workspace files: ${files.length}`,
              `New (unindexed): ${newCount}`,
              `Changed (dirty): ${dirty}`,
              `Sync index: ${SYNC_INDEX_PATH}`,
            ];
            console.log(lines.join("\n"));
          });
      },
      { commands: ["cognee"] },
    );

    // ------------------------------------------------------------------
    // Auto-sync on startup
    // ------------------------------------------------------------------

    if (cfg.autoIndex) {
      api.registerService({
        id: "cognee-auto-sync",
        async start(ctx) {
          resolvedWorkspaceDir = ctx.workspaceDir || process.cwd();

          try {
            const result = await runSync(resolvedWorkspaceDir, ctx.logger);
            ctx.logger.info?.(
              `memory-cognee: auto-sync complete: ${result.added} added, ${result.updated} updated, ${result.skipped} unchanged`,
            );
          } catch (error) {
            ctx.logger.warn?.(`memory-cognee: auto-sync failed: ${String(error)}`);
          }
        },
      });
    }

    // ------------------------------------------------------------------
    // Auto-recall: inject memories before each agent run
    // ------------------------------------------------------------------

    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event, ctx) => {
        await stateReady;

        if (!event.prompt || event.prompt.length < 5) {
          return;
        }
        if (!datasetId) {
          return;
        }

        try {
          const results = await client.search({
            queryText: event.prompt,
            searchType: cfg.searchType,
            datasetIds: [datasetId],
            maxTokens: cfg.maxTokens,
          });

          const filtered = results
            .filter((result) => result.score >= cfg.minScore)
            .slice(0, cfg.maxResults);

          if (filtered.length === 0) {
            return;
          }

          const payload = JSON.stringify(
            filtered.map((result) => ({
              id: result.id,
              score: result.score,
              text: result.text,
              metadata: result.metadata,
            })),
            null,
            2,
          );

          api.logger.info?.(
            `memory-cognee: injecting ${filtered.length} memories for session ${ctx.sessionKey ?? "unknown"}`,
          );

          return {
            prependContext: `<cognee_memories>\nRelevant memories:\n${payload}\n</cognee_memories>`,
          };
        } catch (error) {
          api.logger.warn?.(`memory-cognee: recall failed: ${String(error)}`);
        }
      });
    }

    // ------------------------------------------------------------------
    // Post-agent sync: detect file changes and sync to Cognee
    // ------------------------------------------------------------------

    if (cfg.autoIndex) {
      api.on("agent_end", async (event) => {
        if (!event.success) return;

        await stateReady;

        const workspaceDir = resolvedWorkspaceDir || process.cwd();

        try {
          const files = await collectMemoryFiles(workspaceDir);
          const changedFiles = files.filter((f) => {
            const existing = syncIndex.entries[f.path];
            return !existing || existing.hash !== f.hash;
          });

          if (changedFiles.length === 0) return;

          api.logger.info?.(
            `memory-cognee: detected ${changedFiles.length} changed file(s), syncing...`,
          );

          const result = await syncFiles(client, changedFiles, syncIndex, cfg, api.logger);
          if (result.datasetId) {
            datasetId = result.datasetId;
          }

          api.logger.info?.(
            `memory-cognee: post-agent sync: ${result.added} added, ${result.updated} updated`,
          );
        } catch (error) {
          api.logger.warn?.(`memory-cognee: post-agent sync failed: ${String(error)}`);
        }
      });
    }
  },
};

export default memoryCogneePlugin;
