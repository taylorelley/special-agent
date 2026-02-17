import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSessionManagerOpen = vi.fn();
const mockEstimateTokens = vi.fn();

vi.mock("@mariozechner/pi-coding-agent", () => ({
  estimateTokens: (...args: unknown[]) => mockEstimateTokens(...args),
  SessionManager: {
    open: (...args: unknown[]) => mockSessionManagerOpen(...args),
  },
}));

vi.mock("../compaction.js", () => ({
  SAFETY_MARGIN: 1.2,
}));

vi.mock("./logger.js", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  checkPreflightCompaction,
  PROACTIVE_COMPACTION_THRESHOLD,
} from "./preflight-compaction.js";

function makeBranch(messages: Array<{ role: string; content: string }>) {
  return messages.map((msg) => ({ type: "message" as const, message: msg }));
}

describe("checkPreflightCompaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns shouldCompact: false for empty session", () => {
    mockSessionManagerOpen.mockReturnValue({
      getBranch: () => [],
    });

    const result = checkPreflightCompaction({
      sessionFile: "/tmp/session.json",
      contextWindowTokens: 100000,
    });

    expect(result.shouldCompact).toBe(false);
    expect(result.estimatedTokens).toBe(0);
  });

  it("returns shouldCompact: false when tokens are below threshold", () => {
    // With SAFETY_MARGIN=1.2, 100 * 1.2 = 120 tokens
    // threshold = 100000 * 0.85 = 85000
    mockEstimateTokens.mockReturnValue(100);
    mockSessionManagerOpen.mockReturnValue({
      getBranch: () => makeBranch([{ role: "user", content: "hello" }]),
    });

    const result = checkPreflightCompaction({
      sessionFile: "/tmp/session.json",
      contextWindowTokens: 100000,
    });

    expect(result.shouldCompact).toBe(false);
    expect(result.estimatedTokens).toBe(120); // 100 * 1.2
    expect(result.thresholdTokens).toBe(85000);
  });

  it("returns shouldCompact: true when tokens exceed threshold", () => {
    // threshold = 100000 * 0.85 = 85000
    // 71000 * 1.2 = 85200 >= 85000
    mockEstimateTokens.mockReturnValue(71000);
    mockSessionManagerOpen.mockReturnValue({
      getBranch: () => makeBranch([{ role: "user", content: "big message" }]),
    });

    const result = checkPreflightCompaction({
      sessionFile: "/tmp/session.json",
      contextWindowTokens: 100000,
    });

    expect(result.shouldCompact).toBe(true);
    expect(result.estimatedTokens).toBe(Math.ceil(71000 * 1.2));
    expect(result.thresholdTokens).toBe(85000);
  });

  it("returns shouldCompact: false when session file is missing", () => {
    mockSessionManagerOpen.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    const result = checkPreflightCompaction({
      sessionFile: "/tmp/nonexistent.json",
      contextWindowTokens: 100000,
    });

    expect(result.shouldCompact).toBe(false);
    expect(result.estimatedTokens).toBe(0);
  });

  it("returns shouldCompact: false when session file is corrupt", () => {
    mockSessionManagerOpen.mockImplementation(() => {
      throw new SyntaxError("Unexpected token in JSON");
    });

    const result = checkPreflightCompaction({
      sessionFile: "/tmp/corrupt.json",
      contextWindowTokens: 100000,
    });

    expect(result.shouldCompact).toBe(false);
    expect(result.estimatedTokens).toBe(0);
  });

  it("respects custom threshold parameter", () => {
    // threshold=0.5 → 50000, 42000 * 1.2 = 50400 → should compact
    mockEstimateTokens.mockReturnValue(42000);
    mockSessionManagerOpen.mockReturnValue({
      getBranch: () => makeBranch([{ role: "user", content: "message" }]),
    });

    const result = checkPreflightCompaction({
      sessionFile: "/tmp/session.json",
      contextWindowTokens: 100000,
      threshold: 0.5,
    });

    expect(result.shouldCompact).toBe(true);
    expect(result.thresholdTokens).toBe(50000);
    expect(result.estimatedTokens).toBe(Math.ceil(42000 * 1.2));
  });

  it("does not compact with custom threshold when below it", () => {
    // threshold=0.5 → 50000, 30000 * 1.2 = 36000 < 50000
    mockEstimateTokens.mockReturnValue(30000);
    mockSessionManagerOpen.mockReturnValue({
      getBranch: () => makeBranch([{ role: "user", content: "message" }]),
    });

    const result = checkPreflightCompaction({
      sessionFile: "/tmp/session.json",
      contextWindowTokens: 100000,
      threshold: 0.5,
    });

    expect(result.shouldCompact).toBe(false);
    expect(result.thresholdTokens).toBe(50000);
  });

  it("sums tokens across multiple messages", () => {
    // 3 messages * 30000 tokens = 90000 * 1.2 = 108000 > 85000
    mockEstimateTokens.mockReturnValue(30000);
    mockSessionManagerOpen.mockReturnValue({
      getBranch: () =>
        makeBranch([
          { role: "user", content: "msg1" },
          { role: "assistant", content: "msg2" },
          { role: "user", content: "msg3" },
        ]),
    });

    const result = checkPreflightCompaction({
      sessionFile: "/tmp/session.json",
      contextWindowTokens: 100000,
    });

    expect(result.shouldCompact).toBe(true);
    expect(result.estimatedTokens).toBe(Math.ceil(90000 * 1.2));
  });

  it("skips non-message entries in branch", () => {
    mockEstimateTokens.mockReturnValue(100);
    const branch = [
      { type: "message", message: { role: "user", content: "hi" } },
      { type: "summary", summary: "some summary text" },
      { type: "message", message: { role: "assistant", content: "hello" } },
    ];
    mockSessionManagerOpen.mockReturnValue({
      getBranch: () => branch,
    });

    const result = checkPreflightCompaction({
      sessionFile: "/tmp/session.json",
      contextWindowTokens: 100000,
    });

    // 2 messages * 100 * 1.2 = 240, well under 85000
    expect(result.shouldCompact).toBe(false);
    expect(result.estimatedTokens).toBe(Math.ceil(200 * 1.2));
  });

  it("exports the expected threshold constant", () => {
    expect(PROACTIVE_COMPACTION_THRESHOLD).toBe(0.85);
  });
});
