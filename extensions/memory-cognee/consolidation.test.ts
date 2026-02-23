/**
 * STM-to-LTM Consolidation Pipeline & Reflection System Tests
 *
 * Tests buffer management, message extraction, prompt building, and
 * persistence. LLM calls are NOT tested here — they require a live
 * provider and are gated behind COGNEE_LIVE_TEST=1.
 */

import { describe, test, expect, beforeEach } from "vitest";
import type { ActivationIndex } from "./activation.js";
import {
  extractConversationExcerpts,
  appendToStmBuffer,
  markConsolidated,
  evictOldEntries,
  buildConsolidationPrompt,
  buildReflectionPrompt,
  type StmBuffer,
  type StmEntry,
} from "./consolidation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyBuffer(): StmBuffer {
  return { version: 1, entries: [], turnsSinceConsolidation: 0, turnsSinceReflection: 0 };
}

function makeStmEntry(overrides?: Partial<StmEntry>): StmEntry {
  return {
    id: `stm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    userExcerpts: ["What is TypeScript?"],
    assistantExcerpts: ["TypeScript is a superset of JavaScript with static types."],
    consolidated: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractConversationExcerpts
// ---------------------------------------------------------------------------

describe("extractConversationExcerpts", () => {
  test("extracts user and assistant text from string content", () => {
    const messages = [
      { role: "user", content: "Hello, can you help me?" },
      { role: "assistant", content: "Of course! What do you need?" },
      { role: "user", content: "I need to write a function" },
    ];

    const result = extractConversationExcerpts(messages);
    expect(result.userExcerpts).toHaveLength(2);
    expect(result.userExcerpts[0]).toBe("Hello, can you help me?");
    expect(result.userExcerpts[1]).toBe("I need to write a function");
    expect(result.assistantExcerpts).toHaveLength(1);
    expect(result.assistantExcerpts[0]).toBe("Of course! What do you need?");
  });

  test("extracts text from array content (structured messages)", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this image and explain" },
          { type: "image", url: "data:..." },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "This image shows a chart." },
          { type: "thinking", text: "Let me analyze..." },
        ],
      },
    ];

    const result = extractConversationExcerpts(messages);
    expect(result.userExcerpts).toEqual(["Look at this image and explain"]);
    expect(result.assistantExcerpts).toEqual(["This image shows a chart."]);
  });

  test("skips toolResult messages", () => {
    const messages = [
      { role: "user", content: "Run a search" },
      { role: "assistant", content: "I'll search for that." },
      { role: "toolResult", content: "Search results: ...", toolName: "search" },
      { role: "assistant", content: "Here's what I found." },
    ];

    const result = extractConversationExcerpts(messages);
    expect(result.userExcerpts).toHaveLength(1);
    expect(result.assistantExcerpts).toHaveLength(2);
  });

  test("skips very short messages (<=5 chars)", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "user", content: "What is the weather like today?" },
      { role: "assistant", content: "ok" },
      { role: "assistant", content: "The weather is sunny and warm." },
    ];

    const result = extractConversationExcerpts(messages);
    expect(result.userExcerpts).toEqual(["What is the weather like today?"]);
    expect(result.assistantExcerpts).toEqual(["The weather is sunny and warm."]);
  });

  test("respects maxMessages limit", () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: "user",
      content: `Message number ${i + 1} with enough content`,
    }));

    const result = extractConversationExcerpts(messages, 5);
    expect(result.userExcerpts.length).toBeLessThanOrEqual(5);
  });

  test("handles empty messages array", () => {
    const result = extractConversationExcerpts([]);
    expect(result.userExcerpts).toHaveLength(0);
    expect(result.assistantExcerpts).toHaveLength(0);
  });

  test("handles messages with missing/undefined content", () => {
    const messages = [
      { role: "user" },
      { role: "user", content: undefined },
      { role: "assistant", content: null },
      { role: "user", content: "Valid message content here" },
    ];

    // oxlint-disable-next-line typescript/no-explicit-any
    const result = extractConversationExcerpts(messages as any);
    expect(result.userExcerpts).toEqual(["Valid message content here"]);
    expect(result.assistantExcerpts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// appendToStmBuffer
// ---------------------------------------------------------------------------

describe("appendToStmBuffer", () => {
  test("appends entry and increments counters", () => {
    const buffer = emptyBuffer();
    appendToStmBuffer(buffer, {
      userExcerpts: ["What is Rust?"],
      assistantExcerpts: ["Rust is a systems programming language."],
    });

    expect(buffer.entries).toHaveLength(1);
    expect(buffer.turnsSinceConsolidation).toBe(1);
    expect(buffer.turnsSinceReflection).toBe(1);
    expect(buffer.entries[0].consolidated).toBe(false);
    expect(buffer.entries[0].userExcerpts).toEqual(["What is Rust?"]);
  });

  test("accumulates multiple entries", () => {
    const buffer = emptyBuffer();
    appendToStmBuffer(buffer, { userExcerpts: ["Q1"], assistantExcerpts: ["A1"] });
    appendToStmBuffer(buffer, { userExcerpts: ["Q2"], assistantExcerpts: ["A2"] }, "session-2");

    expect(buffer.entries).toHaveLength(2);
    expect(buffer.turnsSinceConsolidation).toBe(2);
    expect(buffer.turnsSinceReflection).toBe(2);
    expect(buffer.entries[1].sessionKey).toBe("session-2");
  });

  test("generates unique IDs", () => {
    const buffer = emptyBuffer();
    appendToStmBuffer(buffer, { userExcerpts: ["Q1"], assistantExcerpts: ["A1"] });
    appendToStmBuffer(buffer, { userExcerpts: ["Q2"], assistantExcerpts: ["A2"] });

    expect(buffer.entries[0].id).not.toBe(buffer.entries[1].id);
    expect(buffer.entries[0].id).toMatch(/^stm-/);
  });
});

// ---------------------------------------------------------------------------
// markConsolidated
// ---------------------------------------------------------------------------

describe("markConsolidated", () => {
  test("marks specified entries as consolidated", () => {
    const buffer = emptyBuffer();
    buffer.turnsSinceConsolidation = 5;
    const entry1 = makeStmEntry({ id: "stm-1" });
    const entry2 = makeStmEntry({ id: "stm-2" });
    const entry3 = makeStmEntry({ id: "stm-3" });
    buffer.entries = [entry1, entry2, entry3];

    markConsolidated(buffer, ["stm-1", "stm-3"]);

    expect(buffer.entries[0].consolidated).toBe(true);
    expect(buffer.entries[1].consolidated).toBe(false);
    expect(buffer.entries[2].consolidated).toBe(true);
    expect(buffer.turnsSinceConsolidation).toBe(0);
    expect(buffer.lastConsolidatedAt).toBeDefined();
  });

  test("resets turnsSinceConsolidation to zero", () => {
    const buffer = emptyBuffer();
    buffer.turnsSinceConsolidation = 10;
    buffer.entries = [makeStmEntry({ id: "stm-1" })];

    markConsolidated(buffer, ["stm-1"]);
    expect(buffer.turnsSinceConsolidation).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// evictOldEntries
// ---------------------------------------------------------------------------

describe("evictOldEntries", () => {
  test("removes old consolidated entries", () => {
    const buffer = emptyBuffer();
    const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString(); // 10 days ago
    const recentDate = new Date().toISOString();

    buffer.entries = [
      makeStmEntry({ id: "old-consolidated", timestamp: oldDate, consolidated: true }),
      makeStmEntry({ id: "recent-consolidated", timestamp: recentDate, consolidated: true }),
      makeStmEntry({ id: "old-pending", timestamp: oldDate, consolidated: false }),
    ];

    evictOldEntries(buffer, 7);

    expect(buffer.entries).toHaveLength(2);
    const ids = buffer.entries.map((e) => e.id);
    expect(ids).toContain("recent-consolidated");
    expect(ids).toContain("old-pending"); // unconsolidated entries are kept
    expect(ids).not.toContain("old-consolidated");
  });

  test("keeps all entries when none are old enough", () => {
    const buffer = emptyBuffer();
    buffer.entries = [makeStmEntry({ consolidated: true }), makeStmEntry({ consolidated: false })];

    evictOldEntries(buffer, 7);
    expect(buffer.entries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildConsolidationPrompt
// ---------------------------------------------------------------------------

describe("buildConsolidationPrompt", () => {
  test("includes conversation excerpts", () => {
    const entries = [
      makeStmEntry({
        userExcerpts: ["How do I use Docker?"],
        assistantExcerpts: ["Docker is a containerization platform."],
      }),
    ];

    const prompt = buildConsolidationPrompt(entries);
    expect(prompt).toContain("How do I use Docker?");
    expect(prompt).toContain("Docker is a containerization platform.");
    expect(prompt).toContain("memory consolidation system");
    expect(prompt).toContain("JSON array");
  });

  test("includes multiple sessions", () => {
    const entries = [
      makeStmEntry({
        timestamp: "2026-02-01T10:00:00Z",
        userExcerpts: ["Session 1 question"],
        assistantExcerpts: ["Session 1 answer"],
      }),
      makeStmEntry({
        timestamp: "2026-02-02T15:00:00Z",
        userExcerpts: ["Session 2 question"],
        assistantExcerpts: ["Session 2 answer"],
      }),
    ];

    const prompt = buildConsolidationPrompt(entries);
    expect(prompt).toContain("Session 1 question");
    expect(prompt).toContain("Session 2 question");
    expect(prompt).toContain("2026-02-01T10:00:00Z");
    expect(prompt).toContain("2026-02-02T15:00:00Z");
  });

  test("includes memory type instructions", () => {
    const prompt = buildConsolidationPrompt([makeStmEntry()]);
    expect(prompt).toContain('"semantic"');
    expect(prompt).toContain('"episodic"');
    expect(prompt).toContain('"procedural"');
    expect(prompt).toContain('"vault"');
  });
});

// ---------------------------------------------------------------------------
// buildReflectionPrompt
// ---------------------------------------------------------------------------

describe("buildReflectionPrompt", () => {
  let activationIndex: ActivationIndex;

  beforeEach(() => {
    activationIndex = {
      version: 1,
      entries: {
        mem1: {
          memoryId: "mem1",
          memoryType: "semantic",
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: 5,
          pinned: false,
          label: "TypeScript knowledge",
        },
        mem2: {
          memoryId: "mem2",
          memoryType: "episodic",
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: 2,
          pinned: false,
          label: "Docker discussion",
        },
        mem3: {
          memoryId: "mem3",
          memoryType: "vault",
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: 1,
          pinned: true,
          label: "API credentials",
        },
      },
    };
  });

  test("includes memory landscape stats", () => {
    const prompt = buildReflectionPrompt(activationIndex);
    expect(prompt).toContain("Total memories: 3");
    expect(prompt).toContain("semantic=1");
    expect(prompt).toContain("episodic=1");
    expect(prompt).toContain("vault=1");
  });

  test("includes recent memory labels", () => {
    const prompt = buildReflectionPrompt(activationIndex);
    expect(prompt).toContain("TypeScript knowledge");
    expect(prompt).toContain("Docker discussion");
    expect(prompt).toContain("API credentials");
  });

  test("includes reflection instructions", () => {
    const prompt = buildReflectionPrompt(activationIndex);
    expect(prompt).toContain("memory reflection system");
    expect(prompt).toContain("patterns");
    expect(prompt).toContain("contradictions");
    expect(prompt).toContain("JSON array");
  });

  test("handles empty activation index", () => {
    const emptyIndex: ActivationIndex = { version: 1, entries: {} };
    const prompt = buildReflectionPrompt(emptyIndex);
    expect(prompt).toContain("Total memories: 0");
    expect(prompt).toContain("(none)");
  });
});
