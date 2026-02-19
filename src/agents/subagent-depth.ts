import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveAgentIdFromSessionKey,
  resolveStorePath,
} from "../config/sessions.js";

function normalizeSpawnDepth(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  return 0;
}

function normalizeSessionKey(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function readSessionStore(
  sessionKey: string,
  agentId: string,
  cfg?: ReturnType<typeof loadConfig>,
  storeCache?: Map<string, ReturnType<typeof loadSessionStore>>,
) {
  const resolvedCfg = cfg ?? loadConfig();
  const storePath = resolveStorePath(resolvedCfg.session?.store, { agentId });
  if (storeCache) {
    const cached = storeCache.get(storePath);
    if (cached) {
      return cached;
    }
    const store = loadSessionStore(storePath);
    storeCache.set(storePath, store);
    return store;
  }
  return loadSessionStore(storePath);
}

function buildKeyCandidates(sessionKey: string, agentId: string): string[] {
  const candidates = [sessionKey];
  if (!sessionKey.startsWith("agent:")) {
    candidates.push(`agent:${agentId}:${sessionKey}`);
  }
  return candidates;
}

function resolveEntryForSessionKey(
  sessionKey: string,
  cfg?: ReturnType<typeof loadConfig>,
  storeCache?: Map<string, ReturnType<typeof loadSessionStore>>,
): Record<string, unknown> | undefined {
  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  const store = readSessionStore(sessionKey, agentId, cfg, storeCache);
  for (const key of buildKeyCandidates(sessionKey, agentId)) {
    const entry = store[key];
    if (entry && typeof entry === "object") {
      return entry as Record<string, unknown>;
    }
  }
  return undefined;
}

/**
 * Recursively resolves spawn depth from session store or `spawnedBy` chain.
 * Returns 0 for top-level sessions.
 */
export function getSubagentDepthFromSessionStore(sessionKey: string): number {
  const cfg = loadConfig();
  const storeCache = new Map<string, ReturnType<typeof loadSessionStore>>();
  const visited = new Set<string>();
  let current = sessionKey;
  let depth = 0;

  while (current && !visited.has(current)) {
    visited.add(current);
    const entry = resolveEntryForSessionKey(current, cfg, storeCache);
    if (!entry) {
      break;
    }

    const explicitDepth = normalizeSpawnDepth(entry.spawnDepth);
    if (explicitDepth > 0) {
      return explicitDepth + depth;
    }

    const spawnedBy = normalizeSessionKey(entry.spawnedBy);
    if (!spawnedBy) {
      break;
    }

    depth += 1;
    current = spawnedBy;
  }

  return depth;
}
