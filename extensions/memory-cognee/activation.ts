/**
 * Activation Metadata Layer
 *
 * Local metadata store that tracks per-memory access patterns, memory types,
 * and computes decay scores. Inspired by the cognitive-memory OpenClaw extension's
 * multi-store architecture with human-like encoding, decay, and recall.
 *
 * Decay formula: base * e^(-lambda * days) * log2(accessCount + 1) * typeWeight
 *
 * This layer sits on top of Cognee's knowledge graph — Cognee provides semantic
 * relevance, this layer adds temporal freshness and type-aware ranking.
 */

import fs from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryType = "episodic" | "semantic" | "procedural" | "vault";

export type DecayTier = "active" | "fading" | "dormant" | "archived";

export type ActivationEntry = {
  memoryId: string;
  memoryType: MemoryType;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  pinned: boolean;
  label?: string;
  datasetName?: string;
};

export type ActivationIndex = {
  version: 1;
  entries: Record<string, ActivationEntry>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ACTIVATION_INDEX_PATH = join(
  homedir(),
  ".special-agent",
  "memory",
  "cognee",
  "activation-index.json",
);

export const DEFAULT_TYPE_WEIGHTS: Record<MemoryType, number> = {
  episodic: 0.8,
  semantic: 1.2,
  procedural: 1.0,
  vault: Infinity,
};

export const DEFAULT_DECAY_RATE = 0.03;

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function loadActivationIndex(): Promise<ActivationIndex> {
  try {
    const raw = await fs.readFile(ACTIVATION_INDEX_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { version: 1, entries: {} };
    }
    const record = parsed as ActivationIndex;
    record.entries ??= {};
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, entries: {} };
    }
    throw error;
  }
}

export async function saveActivationIndex(index: ActivationIndex): Promise<void> {
  await fs.mkdir(dirname(ACTIVATION_INDEX_PATH), { recursive: true });
  await fs.writeFile(ACTIVATION_INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Decay Scoring
// ---------------------------------------------------------------------------

/**
 * Compute decay score for an activation entry.
 *
 * Formula: base * e^(-lambda * daysSinceAccess) * log2(accessCount + 1) * typeWeight
 *
 * Returns Infinity for pinned/vault entries (immune to decay).
 */
export function computeDecayScore(
  entry: ActivationEntry,
  now: Date,
  typeWeights?: Partial<Record<MemoryType, number>>,
  decayRate?: number,
): number {
  if (entry.pinned || entry.memoryType === "vault") return Infinity;

  const weights: Record<MemoryType, number> = { ...DEFAULT_TYPE_WEIGHTS, ...typeWeights };
  const lambda = decayRate ?? DEFAULT_DECAY_RATE;
  const daysSinceAccess = (now.getTime() - new Date(entry.lastAccessedAt).getTime()) / MS_PER_DAY;
  const base = 1.0;

  return (
    base *
    Math.exp(-lambda * Math.max(0, daysSinceAccess)) *
    Math.log2(entry.accessCount + 1) *
    weights[entry.memoryType]
  );
}

/**
 * Classify a decay score into a human-readable tier.
 *
 * Active (>=0.5), Fading (>=0.2), Dormant (>=0.05), Archived (<0.05).
 */
export function classifyDecayTier(score: number): DecayTier {
  if (!Number.isFinite(score)) return "active";
  if (score >= 0.5) return "active";
  if (score >= 0.2) return "fading";
  if (score >= 0.05) return "dormant";
  return "archived";
}

// ---------------------------------------------------------------------------
// Activation Tracking
// ---------------------------------------------------------------------------

/**
 * Record a recall hit for a memory — increments access count and updates timestamp.
 * Creates a new entry if one doesn't exist.
 */
export function recordAccess(
  index: ActivationIndex,
  memoryId: string,
  memoryType?: MemoryType,
): void {
  const now = new Date().toISOString();
  const existing = index.entries[memoryId];
  if (existing) {
    existing.lastAccessedAt = now;
    existing.accessCount++;
  } else {
    index.entries[memoryId] = {
      memoryId,
      memoryType: memoryType ?? "semantic",
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      pinned: false,
    };
  }
}

/**
 * Register a new memory entry (e.g. when the agent stores via tools or files are synced).
 */
export function registerMemory(
  index: ActivationIndex,
  memoryId: string,
  memoryType: MemoryType,
  opts?: { pinned?: boolean; label?: string; datasetName?: string },
): void {
  const now = new Date().toISOString();
  index.entries[memoryId] = {
    memoryId,
    memoryType,
    createdAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    pinned: opts?.pinned ?? memoryType === "vault",
    label: opts?.label,
    datasetName: opts?.datasetName,
  };
}

// ---------------------------------------------------------------------------
// Memory Type Detection (heuristic)
// ---------------------------------------------------------------------------

const PROCEDURAL_PATTERN =
  /\b(step \d|run |execute |install |how to |workflow|procedure|recipe|command|script)\b/i;
const EPISODIC_PATTERN =
  /\b(happened|occurred|decided|meeting|yesterday|today|on \d{4}|event|session|discussed|agreed)\b/i;

/**
 * Classify content into a memory type using heuristics.
 *
 * - vault: metadata has `pinned: true` or `vault: true`
 * - procedural: steps, commands, workflows, instructions
 * - episodic: dates, events, decisions, meeting notes
 * - semantic: default (knowledge, facts, concepts)
 */
export function detectMemoryType(text: string, metadata?: Record<string, unknown>): MemoryType {
  if (metadata?.pinned === true || metadata?.vault === true) return "vault";

  if (PROCEDURAL_PATTERN.test(text)) return "procedural";
  if (EPISODIC_PATTERN.test(text)) return "episodic";

  return "semantic";
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

/**
 * Identify entries whose decay score falls below the prune threshold.
 * Pinned/vault entries are never pruned.
 */
export function identifyPruneCandidates(
  index: ActivationIndex,
  pruneThreshold: number,
  now: Date,
  typeWeights?: Partial<Record<MemoryType, number>>,
  decayRate?: number,
): string[] {
  const candidates: string[] = [];
  for (const [id, entry] of Object.entries(index.entries)) {
    if (entry.pinned || entry.memoryType === "vault") continue;
    const score = computeDecayScore(entry, now, typeWeights, decayRate);
    if (score < pruneThreshold) {
      candidates.push(id);
    }
  }
  return candidates;
}

/**
 * Remove entries from the activation index.
 */
export function removeEntries(index: ActivationIndex, ids: string[]): void {
  for (const id of ids) {
    delete index.entries[id];
  }
}
