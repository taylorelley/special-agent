/**
 * Activation Metadata Layer Tests
 *
 * Tests decay scoring, memory type detection, access tracking, and pruning.
 */

import { describe, test, expect } from "vitest";
import {
  computeDecayScore,
  classifyDecayTier,
  detectMemoryType,
  recordAccess,
  registerMemory,
  identifyPruneCandidates,
  removeEntries,
  DEFAULT_DECAY_RATE,
  DEFAULT_TYPE_WEIGHTS,
  type ActivationEntry,
  type ActivationIndex,
} from "./activation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ActivationEntry> = {}): ActivationEntry {
  return {
    memoryId: "test-id",
    memoryType: "semantic",
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 1,
    pinned: false,
    ...overrides,
  };
}

function makeIndex(entries: ActivationEntry[] = []): ActivationIndex {
  const index: ActivationIndex = { version: 1, entries: {} };
  for (const entry of entries) {
    index.entries[entry.memoryId] = entry;
  }
  return index;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setTime(d.getTime() - days * 86_400_000);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// computeDecayScore
// ---------------------------------------------------------------------------

describe("computeDecayScore", () => {
  const now = new Date();

  test("returns Infinity for vault entries", () => {
    const entry = makeEntry({ memoryType: "vault" });
    expect(computeDecayScore(entry, now)).toBe(Infinity);
  });

  test("returns Infinity for pinned entries", () => {
    const entry = makeEntry({ pinned: true });
    expect(computeDecayScore(entry, now)).toBe(Infinity);
  });

  test("returns positive score for just-accessed entry with 1 access", () => {
    const entry = makeEntry({ accessCount: 1, lastAccessedAt: now.toISOString() });
    const score = computeDecayScore(entry, now);
    // base(1.0) * e^0 * log2(1+2) * 1.2(semantic) = 1.0 * 1 * log2(3) * 1.2 ≈ 1.902
    expect(score).toBeCloseTo(1.902, 1);
  });

  test("decays over time", () => {
    const recent = makeEntry({
      accessCount: 1,
      lastAccessedAt: now.toISOString(),
    });
    const old = makeEntry({
      accessCount: 1,
      lastAccessedAt: daysAgo(30),
    });

    const recentScore = computeDecayScore(recent, now);
    const oldScore = computeDecayScore(old, now);
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  test("higher access count increases score", () => {
    const low = makeEntry({ accessCount: 1 });
    const high = makeEntry({ accessCount: 10 });

    const lowScore = computeDecayScore(low, now);
    const highScore = computeDecayScore(high, now);
    expect(highScore).toBeGreaterThan(lowScore);
  });

  test("type weights affect score", () => {
    const episodic = makeEntry({ memoryType: "episodic", accessCount: 1 });
    const semantic = makeEntry({ memoryType: "semantic", accessCount: 1 });
    const procedural = makeEntry({ memoryType: "procedural", accessCount: 1 });

    const eScore = computeDecayScore(episodic, now);
    const sScore = computeDecayScore(semantic, now);
    const pScore = computeDecayScore(procedural, now);

    // semantic (1.2) > procedural (1.0) > episodic (0.8)
    expect(sScore).toBeGreaterThan(pScore);
    expect(pScore).toBeGreaterThan(eScore);
  });

  test("custom decay rate changes decay speed", () => {
    const entry = makeEntry({ accessCount: 1, lastAccessedAt: daysAgo(10) });

    const slowDecay = computeDecayScore(entry, now, undefined, 0.01);
    const fastDecay = computeDecayScore(entry, now, undefined, 0.1);
    expect(slowDecay).toBeGreaterThan(fastDecay);
  });

  test("custom type weights override defaults", () => {
    const entry = makeEntry({ memoryType: "episodic", accessCount: 1 });
    const defaultScore = computeDecayScore(entry, now);
    const boostedScore = computeDecayScore(entry, now, { episodic: 2.0 });
    expect(boostedScore).toBeGreaterThan(defaultScore);
  });

  test("zero access count produces a non-zero baseline via log2(0+2)=1", () => {
    const entry = makeEntry({ accessCount: 0 });
    const score = computeDecayScore(entry, now);
    // base(1.0) * e^0 * log2(2) * 1.2(semantic) = 1.2
    expect(score).toBeCloseTo(1.2, 1);
  });
});

// ---------------------------------------------------------------------------
// classifyDecayTier
// ---------------------------------------------------------------------------

describe("classifyDecayTier", () => {
  test("classifies active tier", () => {
    expect(classifyDecayTier(0.7)).toBe("active");
    expect(classifyDecayTier(0.5)).toBe("active");
    expect(classifyDecayTier(1.0)).toBe("active");
  });

  test("classifies fading tier", () => {
    expect(classifyDecayTier(0.3)).toBe("fading");
    expect(classifyDecayTier(0.2)).toBe("fading");
  });

  test("classifies dormant tier", () => {
    expect(classifyDecayTier(0.1)).toBe("dormant");
    expect(classifyDecayTier(0.05)).toBe("dormant");
  });

  test("classifies archived tier", () => {
    expect(classifyDecayTier(0.01)).toBe("archived");
    expect(classifyDecayTier(0)).toBe("archived");
  });

  test("Infinity is active (vault items)", () => {
    expect(classifyDecayTier(Infinity)).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// detectMemoryType
// ---------------------------------------------------------------------------

describe("detectMemoryType", () => {
  test("detects procedural content", () => {
    expect(detectMemoryType("Step 1: run npm install")).toBe("procedural");
    expect(detectMemoryType("Execute the deploy script")).toBe("procedural");
    expect(detectMemoryType("How to configure the database")).toBe("procedural");
  });

  test("detects episodic content", () => {
    expect(detectMemoryType("We decided in the meeting yesterday")).toBe("episodic");
    expect(detectMemoryType("This happened on 2024-01-15")).toBe("episodic");
    expect(detectMemoryType("During today's session we agreed")).toBe("episodic");
  });

  test("defaults to semantic", () => {
    expect(detectMemoryType("TypeScript uses structural typing")).toBe("semantic");
    expect(detectMemoryType("The API returns JSON data")).toBe("semantic");
  });

  test("detects vault from pinned metadata", () => {
    expect(detectMemoryType("anything", { pinned: true })).toBe("vault");
  });

  test("detects vault from vault metadata", () => {
    expect(detectMemoryType("anything", { vault: true })).toBe("vault");
  });

  test("metadata override takes precedence over text heuristics", () => {
    expect(detectMemoryType("Step 1: run npm install", { pinned: true })).toBe("vault");
  });
});

// ---------------------------------------------------------------------------
// recordAccess
// ---------------------------------------------------------------------------

describe("recordAccess", () => {
  test("creates new entry if not exists", () => {
    const index = makeIndex();
    recordAccess(index, "new-id", "episodic");

    const entry = index.entries["new-id"];
    expect(entry).toBeDefined();
    expect(entry!.memoryType).toBe("episodic");
    expect(entry!.accessCount).toBe(1);
    expect(entry!.pinned).toBe(false);
  });

  test("increments accessCount and updates lastAccessedAt for existing", () => {
    const oldDate = daysAgo(5);
    const index = makeIndex([
      makeEntry({ memoryId: "existing", accessCount: 3, lastAccessedAt: oldDate }),
    ]);

    recordAccess(index, "existing");

    const entry = index.entries["existing"];
    expect(entry!.accessCount).toBe(4);
    expect(new Date(entry!.lastAccessedAt).getTime()).toBeGreaterThan(new Date(oldDate).getTime());
  });

  test("defaults to semantic when memoryType not provided for new entry", () => {
    const index = makeIndex();
    recordAccess(index, "new-id");
    expect(index.entries["new-id"]!.memoryType).toBe("semantic");
  });
});

// ---------------------------------------------------------------------------
// registerMemory
// ---------------------------------------------------------------------------

describe("registerMemory", () => {
  test("creates entry with correct fields", () => {
    const index = makeIndex();
    registerMemory(index, "mem-1", "procedural", {
      label: "deploy script",
      datasetName: "test-dataset",
    });

    const entry = index.entries["mem-1"];
    expect(entry).toBeDefined();
    expect(entry!.memoryType).toBe("procedural");
    expect(entry!.accessCount).toBe(0);
    expect(entry!.pinned).toBe(false);
    expect(entry!.label).toBe("deploy script");
    expect(entry!.datasetName).toBe("test-dataset");
  });

  test("vault type is auto-pinned", () => {
    const index = makeIndex();
    registerMemory(index, "mem-vault", "vault");
    expect(index.entries["mem-vault"]!.pinned).toBe(true);
  });

  test("explicit pinned overrides auto-pin", () => {
    const index = makeIndex();
    registerMemory(index, "mem-1", "semantic", { pinned: true });
    expect(index.entries["mem-1"]!.pinned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// identifyPruneCandidates
// ---------------------------------------------------------------------------

describe("identifyPruneCandidates", () => {
  const now = new Date();

  test("excludes pinned entries", () => {
    const index = makeIndex([
      makeEntry({
        memoryId: "pinned",
        pinned: true,
        accessCount: 0,
        lastAccessedAt: daysAgo(365),
      }),
    ]);
    const candidates = identifyPruneCandidates(index, 0.05, now);
    expect(candidates).toEqual([]);
  });

  test("excludes vault entries", () => {
    const index = makeIndex([
      makeEntry({
        memoryId: "vault-item",
        memoryType: "vault",
        accessCount: 0,
        lastAccessedAt: daysAgo(365),
      }),
    ]);
    const candidates = identifyPruneCandidates(index, 0.05, now);
    expect(candidates).toEqual([]);
  });

  test("returns entries below threshold", () => {
    const index = makeIndex([
      makeEntry({
        memoryId: "old",
        accessCount: 1,
        lastAccessedAt: daysAgo(365),
      }),
    ]);
    const candidates = identifyPruneCandidates(index, 0.05, now);
    expect(candidates).toContain("old");
  });

  test("returns empty array when all entries are above threshold", () => {
    const index = makeIndex([
      makeEntry({
        memoryId: "recent",
        accessCount: 5,
        lastAccessedAt: now.toISOString(),
      }),
    ]);
    const candidates = identifyPruneCandidates(index, 0.05, now);
    expect(candidates).toEqual([]);
  });

  test("zero-access old entries are prune candidates when score decays below threshold", () => {
    const index = makeIndex([
      makeEntry({
        memoryId: "never-accessed",
        accessCount: 0,
        lastAccessedAt: daysAgo(365),
      }),
    ]);
    const candidates = identifyPruneCandidates(index, 0.01, now);
    expect(candidates).toContain("never-accessed");
  });
});

// ---------------------------------------------------------------------------
// removeEntries
// ---------------------------------------------------------------------------

describe("removeEntries", () => {
  test("removes specified entries", () => {
    const index = makeIndex([
      makeEntry({ memoryId: "a" }),
      makeEntry({ memoryId: "b" }),
      makeEntry({ memoryId: "c" }),
    ]);

    removeEntries(index, ["a", "c"]);

    expect(Object.keys(index.entries)).toEqual(["b"]);
  });

  test("silently ignores non-existent IDs", () => {
    const index = makeIndex([makeEntry({ memoryId: "a" })]);
    removeEntries(index, ["nonexistent"]);
    expect(Object.keys(index.entries)).toEqual(["a"]);
  });
});
