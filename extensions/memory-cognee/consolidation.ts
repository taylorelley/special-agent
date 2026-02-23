/**
 * STM-to-LTM Consolidation Pipeline & Reflection System
 *
 * Captures conversation excerpts into a short-term memory (STM) buffer after
 * each agent turn, then periodically uses LLM calls to consolidate them into
 * durable long-term memories stored in Cognee.
 *
 * Reflection periodically reviews the memory landscape via LLM to identify
 * patterns, contradictions, and gaps — generating meta-insights.
 *
 * Follows the LLM invocation pattern from extensions/llm-task and
 * src/hooks/llm-slug-generator.ts (dynamic import of runEmbeddedPiAgent).
 */

import fs from "node:fs/promises";
import os from "node:os";
import { homedir } from "node:os";
import path from "node:path";
import { dirname, join } from "node:path";
import type { CogneeClient } from "./client.js";
import {
  registerMemory,
  computeDecayScore,
  classifyDecayTier,
  detectMemoryType,
  type ActivationIndex,
  type MemoryType,
} from "./activation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StmEntry = {
  id: string;
  timestamp: string;
  sessionKey?: string;
  userExcerpts: string[];
  assistantExcerpts: string[];
  consolidated: boolean;
};

export type StmBuffer = {
  version: 1;
  entries: StmEntry[];
  lastConsolidatedAt?: string;
  lastReflectedAt?: string;
  turnsSinceConsolidation: number;
  turnsSinceReflection: number;
};

export type ConsolidatedMemory = {
  text: string;
  memoryType: MemoryType;
  label?: string;
  pinned?: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STM_BUFFER_PATH = join(
  homedir(),
  ".special-agent",
  "memory",
  "cognee",
  "stm-buffer.json",
);

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function loadStmBuffer(): Promise<StmBuffer> {
  try {
    const raw = await fs.readFile(STM_BUFFER_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return emptyBuffer();
    }
    const buf = parsed as StmBuffer;
    buf.entries ??= [];
    buf.turnsSinceConsolidation ??= 0;
    buf.turnsSinceReflection ??= 0;
    return buf;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyBuffer();
    }
    throw error;
  }
}

export async function saveStmBuffer(buffer: StmBuffer): Promise<void> {
  await fs.mkdir(dirname(STM_BUFFER_PATH), { recursive: true });
  await fs.writeFile(STM_BUFFER_PATH, JSON.stringify(buffer, null, 2), "utf-8");
}

function emptyBuffer(): StmBuffer {
  return { version: 1, entries: [], turnsSinceConsolidation: 0, turnsSinceReflection: 0 };
}

// ---------------------------------------------------------------------------
// Message extraction
// ---------------------------------------------------------------------------

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (
      content
        .filter(
          // oxlint-disable-next-line typescript/no-explicit-any
          (c: any) => c.type === "text" && typeof c.text === "string",
        )
        // oxlint-disable-next-line typescript/no-explicit-any
        .map((c: any) => c.text as string)
        .join("\n")
    );
  }
  return "";
}

/**
 * Extract user and assistant text content from an agent_end messages array.
 * Skips tool calls and tool results to keep STM focused on conversation content.
 */
export function extractConversationExcerpts(
  messages: unknown[],
  maxMessages = 20,
): { userExcerpts: string[]; assistantExcerpts: string[] } {
  const userExcerpts: string[] = [];
  const assistantExcerpts: string[] = [];

  for (const msg of messages.slice(-(maxMessages * 2))) {
    const m = msg as { role?: string; content?: unknown };
    if (m.role === "user") {
      const text = extractTextContent(m.content);
      if (text && text.length > 5) userExcerpts.push(text);
    } else if (m.role === "assistant") {
      const text = extractTextContent(m.content);
      if (text && text.length > 5) assistantExcerpts.push(text);
    }
  }

  return {
    userExcerpts: userExcerpts.slice(-maxMessages),
    assistantExcerpts: assistantExcerpts.slice(-maxMessages),
  };
}

// ---------------------------------------------------------------------------
// STM buffer operations
// ---------------------------------------------------------------------------

export function appendToStmBuffer(
  buffer: StmBuffer,
  excerpts: { userExcerpts: string[]; assistantExcerpts: string[] },
  sessionKey?: string,
): void {
  const entry: StmEntry = {
    id: `stm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    sessionKey,
    userExcerpts: excerpts.userExcerpts,
    assistantExcerpts: excerpts.assistantExcerpts,
    consolidated: false,
  };
  buffer.entries.push(entry);
  buffer.turnsSinceConsolidation++;
  buffer.turnsSinceReflection++;
}

export function markConsolidated(buffer: StmBuffer, entryIds: string[]): void {
  const idSet = new Set(entryIds);
  for (const entry of buffer.entries) {
    if (idSet.has(entry.id)) {
      entry.consolidated = true;
    }
  }
  buffer.lastConsolidatedAt = new Date().toISOString();
  buffer.turnsSinceConsolidation = 0;
}

const MS_PER_DAY = 86_400_000;

export function evictOldEntries(buffer: StmBuffer, maxAgeDays: number): void {
  const cutoff = Date.now() - maxAgeDays * MS_PER_DAY;
  buffer.entries = buffer.entries.filter((entry) => {
    if (!entry.consolidated) return true;
    return new Date(entry.timestamp).getTime() > cutoff;
  });
}

// ---------------------------------------------------------------------------
// LLM invocation
// ---------------------------------------------------------------------------

// oxlint-disable-next-line typescript/no-explicit-any
type RunEmbeddedPiAgentFn = (params: Record<string, unknown>) => Promise<any>;

let cachedRunner: RunEmbeddedPiAgentFn | null = null;

async function loadRunEmbeddedPiAgent(): Promise<RunEmbeddedPiAgentFn> {
  if (cachedRunner) return cachedRunner;
  try {
    const mod = await import("../../src/agents/pi-embedded-runner.js");
    // oxlint-disable-next-line typescript/no-explicit-any
    if (typeof (mod as any).runEmbeddedPiAgent === "function") {
      // oxlint-disable-next-line typescript/no-explicit-any
      cachedRunner = (mod as any).runEmbeddedPiAgent;
      return cachedRunner!;
    }
  } catch {
    // ignore
  }
  const mod = await import("../../src/agents/pi-embedded-runner.js");
  if (typeof mod.runEmbeddedPiAgent !== "function") {
    throw new Error("runEmbeddedPiAgent not available");
  }
  cachedRunner = mod.runEmbeddedPiAgent as RunEmbeddedPiAgentFn;
  return cachedRunner;
}

// oxlint-disable-next-line typescript/no-explicit-any
function collectText(payloads: any[] | undefined): string {
  if (!payloads) return "";
  return (
    payloads
      // oxlint-disable-next-line typescript/no-explicit-any
      .filter((p: any) => !p.isError && typeof p.text === "string")
      // oxlint-disable-next-line typescript/no-explicit-any
      .map((p: any) => p.text as string)
      .join("\n")
      .trim()
  );
}

export async function callLlm(params: {
  config: unknown;
  prompt: string;
  timeoutMs: number;
}): Promise<string | null> {
  // Dynamic imports for agent scope helpers
  const agentScope = await import("../../src/agents/agent-scope.js");
  const runEmbeddedPiAgent = await loadRunEmbeddedPiAgent();

  // oxlint-disable-next-line typescript/no-explicit-any
  const cfg = params.config as any;
  const agentId = agentScope.resolveDefaultAgentId(cfg);
  const workspaceDir = agentScope.resolveAgentWorkspaceDir(cfg, agentId);
  const agentDir = agentScope.resolveAgentDir(cfg, agentId);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sa-consolidation-"));
  const sessionFile = path.join(tempDir, "session.jsonl");

  try {
    const runId = `consolidation-${Date.now()}`;
    const result = await runEmbeddedPiAgent({
      sessionId: `consolidation-${Date.now()}`,
      sessionKey: "temp:consolidation",
      agentId,
      sessionFile,
      workspaceDir,
      agentDir,
      config: cfg,
      prompt: params.prompt,
      timeoutMs: params.timeoutMs,
      runId,
      disableTools: true,
    });
    return collectText(result?.payloads) || null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildConsolidationPrompt(entries: StmEntry[]): string {
  const sections = entries
    .map((entry) => {
      const userText =
        entry.userExcerpts.length > 0 ? `User: ${entry.userExcerpts.join("\n")}` : "";
      const assistantText =
        entry.assistantExcerpts.length > 0
          ? `Assistant: ${entry.assistantExcerpts.join("\n")}`
          : "";
      return `### Session at ${entry.timestamp}\n${userText}\n${assistantText}`;
    })
    .join("\n\n");

  return `You are a memory consolidation system. Review these conversation excerpts from recent agent sessions and extract durable knowledge.

## Recent Conversations

${sections}

## Instructions

Extract key information worth remembering long-term. For each piece of knowledge, classify it:
- "semantic": Facts, concepts, preferences, technical knowledge
- "episodic": Decisions made, events that occurred, meeting outcomes
- "procedural": Steps, commands, workflows, how-to instructions
- "vault": Critical information that should never be forgotten (use sparingly)

Deduplicate — if multiple conversations cover the same topic, merge into one consolidated memory.
Skip trivial greetings, small talk, and information that's only relevant in the moment.

Return a JSON array (no markdown fences):
[
  { "text": "...", "memoryType": "semantic|episodic|procedural|vault", "label": "short label" }
]

If nothing is worth consolidating, return an empty array: []`;
}

export function buildReflectionPrompt(
  activationIndex: ActivationIndex,
  typeWeights?: Partial<Record<MemoryType, number>>,
  decayRate?: number,
): string {
  const now = new Date();
  const entries = Object.values(activationIndex.entries);
  const total = entries.length;

  const types: Record<string, number> = { episodic: 0, semantic: 0, procedural: 0, vault: 0 };
  const tiers: Record<string, number> = { active: 0, fading: 0, dormant: 0, archived: 0 };

  for (const entry of entries) {
    types[entry.memoryType] = (types[entry.memoryType] ?? 0) + 1;
    const score = computeDecayScore(entry, now, typeWeights, decayRate);
    const tier = classifyDecayTier(score);
    tiers[tier] = (tiers[tier] ?? 0) + 1;
  }

  const recentLabels = entries
    .filter((e) => e.label)
    .sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime())
    .slice(0, 20)
    .map((e) => `- [${e.memoryType}] ${e.label}`)
    .join("\n");

  return `You are a memory reflection system. Review this agent's memory landscape and generate meta-insights.

## Memory Landscape

Total memories: ${total}
By type: episodic=${types.episodic}, semantic=${types.semantic}, procedural=${types.procedural}, vault=${types.vault}
By tier: active=${tiers.active}, fading=${tiers.fading}, dormant=${tiers.dormant}, archived=${tiers.archived}

## Recent Memory Labels
${recentLabels || "(none)"}

## Instructions

Analyze the memory landscape and generate insights:
1. Identify patterns across memories (recurring topics, user preferences)
2. Flag potential contradictions (conflicting information)
3. Note gaps (areas where more knowledge would be helpful)
4. Suggest meta-insights that connect disparate memories

Return a JSON array (no markdown fences):
[
  { "text": "...", "memoryType": "semantic", "label": "short label" }
]

If no meaningful insights emerge, return an empty array: []`;
}

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (m) return (m[1] ?? "").trim();
  return trimmed;
}

function parseConsolidatedMemories(raw: string): ConsolidatedMemory[] {
  const cleaned = stripCodeFences(raw);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];

  const validTypes: Set<string> = new Set(["episodic", "semantic", "procedural", "vault"]);
  return (
    parsed
      .filter(
        // oxlint-disable-next-line typescript/no-explicit-any
        (item: any) =>
          item && typeof item === "object" && typeof item.text === "string" && item.text.length > 0,
      )
      // oxlint-disable-next-line typescript/no-explicit-any
      .map((item: any) => ({
        text: item.text as string,
        memoryType: validTypes.has(item.memoryType)
          ? (item.memoryType as MemoryType)
          : detectMemoryType(item.text as string),
        label: typeof item.label === "string" ? item.label : undefined,
        pinned: item.pinned === true,
      }))
  );
}

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

export type ConsolidationParams = {
  buffer: StmBuffer;
  config: unknown;
  client: CogneeClient;
  datasetId?: string;
  datasetName: string;
  activationIndex: ActivationIndex;
  logger: { info?: (msg: string) => void; warn?: (msg: string) => void };
  autoCognify: boolean;
  timeoutMs: number;
  stmMaxAgeDays: number;
};

export async function runConsolidation(params: ConsolidationParams): Promise<number> {
  const unconsolidated = params.buffer.entries.filter((e) => !e.consolidated);
  if (unconsolidated.length === 0) return 0;

  const totalExcerpts = unconsolidated.reduce(
    (sum, e) => sum + e.userExcerpts.length + e.assistantExcerpts.length,
    0,
  );
  if (unconsolidated.length === 1 && totalExcerpts < 3) return 0;

  const prompt = buildConsolidationPrompt(unconsolidated);
  const raw = await callLlm({ config: params.config, prompt, timeoutMs: params.timeoutMs });
  if (!raw) return 0;

  let memories: ConsolidatedMemory[];
  try {
    memories = parseConsolidatedMemories(raw);
  } catch {
    params.logger.warn?.("memory-cognee: consolidation LLM returned invalid JSON");
    return 0;
  }

  if (memories.length === 0) {
    markConsolidated(
      params.buffer,
      unconsolidated.map((e) => e.id),
    );
    evictOldEntries(params.buffer, params.stmMaxAgeDays);
    return 0;
  }

  let storedCount = 0;
  let latestDatasetId = params.datasetId;

  for (const mem of memories) {
    try {
      const response = await params.client.add({
        data: mem.text,
        datasetName: params.datasetName,
        datasetId: latestDatasetId,
      });

      if (response.datasetId) {
        latestDatasetId = response.datasetId;
      }

      const memoryId = response.dataId ?? `consolidated-${Date.now()}-${storedCount}`;
      registerMemory(params.activationIndex, memoryId, mem.memoryType, {
        pinned: mem.pinned,
        label: mem.label,
        datasetName: params.datasetName,
      });
      storedCount++;
    } catch (e) {
      params.logger.warn?.(`memory-cognee: failed to store consolidated memory: ${String(e)}`);
    }
  }

  if (params.autoCognify && latestDatasetId) {
    try {
      await params.client.cognify({ datasetIds: [latestDatasetId] });
    } catch (e) {
      params.logger.warn?.(`memory-cognee: cognify after consolidation failed: ${String(e)}`);
    }
  }

  markConsolidated(
    params.buffer,
    unconsolidated.map((e) => e.id),
  );
  evictOldEntries(params.buffer, params.stmMaxAgeDays);

  return storedCount;
}

// ---------------------------------------------------------------------------
// Reflection
// ---------------------------------------------------------------------------

export type ReflectionParams = {
  activationIndex: ActivationIndex;
  buffer: StmBuffer;
  config: unknown;
  client: CogneeClient;
  datasetId?: string;
  datasetName: string;
  logger: { info?: (msg: string) => void; warn?: (msg: string) => void };
  autoCognify: boolean;
  timeoutMs: number;
  typeWeights?: Partial<Record<MemoryType, number>>;
  decayRate?: number;
};

export async function runReflection(params: ReflectionParams): Promise<number> {
  const prompt = buildReflectionPrompt(
    params.activationIndex,
    params.typeWeights,
    params.decayRate,
  );
  const raw = await callLlm({ config: params.config, prompt, timeoutMs: params.timeoutMs });
  if (!raw) return 0;

  let insights: ConsolidatedMemory[];
  try {
    insights = parseConsolidatedMemories(raw);
  } catch {
    params.logger.warn?.("memory-cognee: reflection LLM returned invalid JSON");
    return 0;
  }

  if (insights.length === 0) {
    params.buffer.lastReflectedAt = new Date().toISOString();
    params.buffer.turnsSinceReflection = 0;
    return 0;
  }

  let storedCount = 0;
  let latestDatasetId = params.datasetId;

  for (const insight of insights) {
    try {
      const response = await params.client.add({
        data: insight.text,
        datasetName: params.datasetName,
        datasetId: latestDatasetId,
      });

      if (response.datasetId) {
        latestDatasetId = response.datasetId;
      }

      const memoryId = response.dataId ?? `reflection-${Date.now()}-${storedCount}`;
      registerMemory(params.activationIndex, memoryId, insight.memoryType, {
        label: insight.label,
        datasetName: params.datasetName,
      });
      storedCount++;
    } catch (e) {
      params.logger.warn?.(`memory-cognee: failed to store reflection insight: ${String(e)}`);
    }
  }

  if (params.autoCognify && latestDatasetId) {
    try {
      await params.client.cognify({ datasetIds: [latestDatasetId] });
    } catch (e) {
      params.logger.warn?.(`memory-cognee: cognify after reflection failed: ${String(e)}`);
    }
  }

  params.buffer.lastReflectedAt = new Date().toISOString();
  params.buffer.turnsSinceReflection = 0;

  return storedCount;
}
