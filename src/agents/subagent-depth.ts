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

function readSessionStore(sessionKey: string) {
  const cfg = loadConfig();
  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  return loadSessionStore(storePath);
}

function buildKeyCandidates(sessionKey: string): string[] {
  const candidates = [sessionKey];
  if (!sessionKey.startsWith("agent:")) {
    const agentId = resolveAgentIdFromSessionKey(sessionKey);
    candidates.push(`agent:${agentId}:${sessionKey}`);
  }
  return candidates;
}

function resolveEntryForSessionKey(sessionKey: string): Record<string, unknown> | undefined {
  const store = readSessionStore(sessionKey);
  for (const key of buildKeyCandidates(sessionKey)) {
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
  const visited = new Set<string>();
  let current = sessionKey;
  let depth = 0;

  while (current && !visited.has(current)) {
    visited.add(current);
    const entry = resolveEntryForSessionKey(current);
    if (!entry) {
      break;
    }

    const explicitDepth = normalizeSpawnDepth(entry.spawnDepth);
    if (explicitDepth > 0) {
      return explicitDepth;
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
