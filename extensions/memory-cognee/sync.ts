/**
 * Cognee File Sync
 *
 * Collects memory files from the workspace and syncs them to Cognee.
 * Extracted from the memory-cognee plugin for modularity.
 */

import fs from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { CogneeClient, CogneePluginConfig } from "./client.js";
import { hashText } from "../../src/memory/internal.js";
import { CogneeHttpError } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryFile = {
  /** Relative path from workspace root (e.g. "MEMORY.md", "memory/tools.md") */
  path: string;
  /** Absolute path on disk */
  absPath: string;
  /** File content */
  content: string;
  /** SHA-256 hex hash of content */
  hash: string;
};

export type SyncIndex = {
  datasetId?: string;
  datasetName?: string;
  entries: Record<string, { hash: string; dataId?: string }>;
};

export type DatasetState = Record<string, string>;

export type SyncResult = {
  added: number;
  updated: number;
  skipped: number;
  errors: number;
};

export type SyncLogger = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
};

// ---------------------------------------------------------------------------
// Persistence paths
// ---------------------------------------------------------------------------

export const STATE_PATH = join(homedir(), ".special-agent", "memory", "cognee", "datasets.json");
export const SYNC_INDEX_PATH = join(
  homedir(),
  ".special-agent",
  "memory",
  "cognee",
  "sync-index.json",
);

/** Glob patterns for memory files, relative to workspace root. */
const MEMORY_FILE_PATTERNS = ["MEMORY.md", "memory.md", "memory"];

// ---------------------------------------------------------------------------
// Persistence — dataset state & sync index
// ---------------------------------------------------------------------------

export async function loadDatasetState(): Promise<DatasetState> {
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

export async function saveDatasetState(state: DatasetState): Promise<void> {
  await fs.mkdir(dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export async function loadSyncIndex(): Promise<SyncIndex> {
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

export async function saveSyncIndex(state: SyncIndex): Promise<void> {
  await fs.mkdir(dirname(SYNC_INDEX_PATH), { recursive: true });
  await fs.writeFile(SYNC_INDEX_PATH, JSON.stringify(state, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// File collection — scan workspace for memory markdown files
// ---------------------------------------------------------------------------

export async function collectMemoryFiles(workspaceDir: string): Promise<MemoryFile[]> {
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
  depth: number = 0,
  maxDepth: number = 50,
): Promise<MemoryFile[]> {
  if (depth >= maxDepth) return [];

  const realDir = await fs.realpath(dir);
  if (seen.has(realDir)) return [];
  seen.add(realDir);

  const files: MemoryFile[] = [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await scanDir(absPath, workspaceDir, seen, depth + 1, maxDepth);
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
// Unified sync logic
// ---------------------------------------------------------------------------

/**
 * Sync memory files to Cognee (add new, update changed, skip unchanged).
 *
 * @mutates syncIndex — entries, datasetId, and datasetName are updated
 * in-place during processing and persisted to disk at the end.
 */
export async function syncFiles(
  client: CogneeClient,
  files: MemoryFile[],
  syncIndex: SyncIndex,
  cfg: Required<CogneePluginConfig>,
  logger: SyncLogger,
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
          // Recoverable: resource gone or version conflict — fall back to add.
          // Use strict patterns to avoid false positives on arbitrary messages.
          const isRecoverable =
            (updateError instanceof CogneeHttpError &&
              (updateError.status === 404 || updateError.status === 409)) ||
            (updateError instanceof Error &&
              (/\bnot found\b/i.test(updateError.message) ||
                /\b404\b/.test(updateError.message) ||
                /\b409\b/.test(updateError.message)));
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
