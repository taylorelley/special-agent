/**
 * Memory Tool Registration
 *
 * Extracted from index.ts — registers the memory_recall, memory_store, and
 * memory_forget tools with the plugin API.
 */

import type { SpecialAgentPluginApi } from "special-agent/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { CogneeClient, CogneePluginConfig } from "./client.js";
import {
  saveActivationIndex,
  recordAccess,
  registerMemory,
  applyDecayRanking,
  classifyDecayTier,
  detectMemoryType,
  removeEntries,
  type ActivationIndex,
  type MemoryType,
} from "./activation.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type MemoryToolContext = {
  api: SpecialAgentPluginApi;
  cfg: Required<CogneePluginConfig>;
  client: CogneeClient;
  getDatasetId: () => string | undefined;
  setDatasetId: (id: string) => void;
  activationIndex: ActivationIndex;
  stateReady: Promise<unknown>;
  activationReady: Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const VALID_MEMORY_TYPES: MemoryType[] = ["episodic", "semantic", "procedural", "vault"];

export function registerMemoryTools(ctx: MemoryToolContext): void {
  const { api, cfg, client, activationIndex } = ctx;

  // ---- memory_recall ----

  api.registerTool(
    {
      name: "memory_recall",
      label: "Memory Recall (Cognee)",
      description:
        "Search through Cognee knowledge graph memories. Results are ranked by relevance and recency (decay scoring).",
      parameters: Type.Object({
        query: Type.String({ description: "Search query describing what to recall" }),
        limit: Type.Optional(Type.Number({ description: "Max results (default: 6)" })),
        memoryType: Type.Optional(
          Type.Unsafe<MemoryType>({
            type: "string",
            enum: VALID_MEMORY_TYPES,
            description: "Filter by memory type",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { query, limit, memoryType } = params as {
          query: string;
          limit?: number;
          memoryType?: MemoryType;
        };

        await Promise.all([ctx.stateReady, ctx.activationReady]);

        const datasetId = ctx.getDatasetId();
        if (!datasetId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No dataset indexed yet. Run cognee index first.",
              },
            ],
            details: { error: "no_dataset" },
          };
        }

        const maxResults = limit ?? cfg.maxResults;
        const results = await client.search({
          queryText: query,
          searchType: cfg.searchType,
          datasetIds: [datasetId],
          topK: maxResults * 2,
        });

        let scored = applyDecayRanking(results, activationIndex, cfg.typeWeights, cfg.decayRate);

        if (memoryType) {
          scored = scored.filter((r) => r.activation?.memoryType === memoryType);
        }

        const topResults = scored.slice(0, maxResults);

        for (const r of topResults) {
          recordAccess(activationIndex, r.id, r.activation?.memoryType);
        }
        saveActivationIndex(activationIndex).catch((e) => {
          api.logger.warn?.(`memory-cognee: failed to save activation index: ${String(e)}`);
        });

        if (topResults.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No relevant memories found." }],
            details: { count: 0 },
          };
        }

        const text = topResults
          .map((r, i) => {
            const tier = r.activation ? classifyDecayTier(r.decayScore) : "unknown";
            const mType = r.activation?.memoryType ?? "unknown";
            return `${i + 1}. [${mType}/${tier}] ${r.text} (${(r.combinedScore * 100).toFixed(0)}%)`;
          })
          .join("\n");

        return {
          content: [
            { type: "text" as const, text: `Found ${topResults.length} memories:\n\n${text}` },
          ],
          details: {
            count: topResults.length,
            memories: topResults.map((r) => ({
              id: r.id,
              text: r.text,
              score: r.score,
              decayScore: r.decayScore,
              combinedScore: r.combinedScore,
              memoryType: r.activation?.memoryType,
              decayTier: r.activation ? classifyDecayTier(r.decayScore) : undefined,
            })),
          },
        };
      },
    },
    { name: "memory_recall" },
  );

  // ---- memory_store ----

  api.registerTool(
    {
      name: "memory_store",
      label: "Memory Store (Cognee)",
      description:
        "Save information in Cognee knowledge graph memory. Use for preferences, facts, decisions, procedures.",
      parameters: Type.Object({
        text: Type.String({ description: "Information to remember" }),
        memoryType: Type.Optional(
          Type.Unsafe<MemoryType>({
            type: "string",
            enum: VALID_MEMORY_TYPES,
            description: "Memory type (auto-detected if omitted)",
          }),
        ),
        pinned: Type.Optional(Type.Boolean({ description: "Pin this memory (immune to decay)" })),
        label: Type.Optional(Type.String({ description: "Short label for this memory" })),
      }),
      async execute(_toolCallId, params) {
        const { text, memoryType, pinned, label } = params as {
          text: string;
          memoryType?: MemoryType;
          pinned?: boolean;
          label?: string;
        };

        await Promise.all([ctx.stateReady, ctx.activationReady]);

        const resolvedType = memoryType ?? detectMemoryType(text);

        const response = await client.add({
          data: text,
          datasetName: cfg.datasetName,
          datasetId: ctx.getDatasetId(),
        });

        if (response.datasetId && response.datasetId !== ctx.getDatasetId()) {
          ctx.setDatasetId(response.datasetId);
        }

        const memoryId = response.dataId ?? `agent-${Date.now()}`;
        registerMemory(activationIndex, memoryId, resolvedType, {
          pinned: pinned ?? resolvedType === "vault",
          label,
          datasetName: cfg.datasetName,
        });
        saveActivationIndex(activationIndex).catch((e) => {
          api.logger.warn?.(`memory-cognee: failed to save activation index: ${String(e)}`);
        });

        const currentDatasetId = ctx.getDatasetId();
        if (cfg.autoCognify && currentDatasetId) {
          try {
            await client.cognify({ datasetIds: [currentDatasetId] });
          } catch (e) {
            api.logger.warn?.(`memory-cognee: cognify after store failed: ${String(e)}`);
          }
        }

        const truncated = text.length > 100 ? `${text.slice(0, 100)}...` : text;
        return {
          content: [
            {
              type: "text" as const,
              text: `Stored [${resolvedType}]: "${truncated}"${pinned ? " (pinned)" : ""}`,
            },
          ],
          details: {
            action: "created",
            memoryId,
            memoryType: resolvedType,
            pinned: pinned ?? false,
          },
        };
      },
    },
    { name: "memory_store" },
  );

  // ---- memory_forget ----

  api.registerTool(
    {
      name: "memory_forget",
      label: "Memory Forget (Cognee)",
      description:
        "Remove specific memories from the knowledge graph. Search by query to find candidates, or specify an ID directly.",
      parameters: Type.Object({
        query: Type.Optional(Type.String({ description: "Search query to find memory to forget" })),
        memoryId: Type.Optional(Type.String({ description: "Specific memory ID to delete" })),
      }),
      async execute(_toolCallId, params) {
        const { query, memoryId } = params as { query?: string; memoryId?: string };

        await Promise.all([ctx.stateReady, ctx.activationReady]);

        const datasetId = ctx.getDatasetId();

        if (memoryId) {
          if (datasetId) {
            try {
              await client.delete({ dataId: memoryId, datasetId });
            } catch (e) {
              api.logger.warn?.(`memory-cognee: Cognee delete failed: ${String(e)}`);
            }
          }
          removeEntries(activationIndex, [memoryId]);
          saveActivationIndex(activationIndex).catch((e) => {
            api.logger.warn?.(`memory-cognee: failed to save activation index: ${String(e)}`);
          });
          return {
            content: [{ type: "text" as const, text: `Memory ${memoryId} forgotten.` }],
            details: { action: "deleted", id: memoryId },
          };
        }

        if (query && datasetId) {
          const results = await client.search({
            queryText: query,
            searchType: cfg.searchType,
            datasetIds: [datasetId],
            topK: 5,
          });

          if (results.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No matching memories found." }],
              details: { found: 0 },
            };
          }

          const list = results
            .map((r) => `- [${r.id.slice(0, 8)}] ${r.text.slice(0, 60)}...`)
            .join("\n");
          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${results.length} candidates. Specify memoryId:\n${list}`,
              },
            ],
            details: {
              action: "candidates",
              candidates: results.map((r) => ({
                id: r.id,
                text: r.text,
                score: r.score,
              })),
            },
          };
        }

        return {
          content: [{ type: "text" as const, text: "Provide query or memoryId." }],
          details: { error: "missing_param" },
        };
      },
    },
    { name: "memory_forget" },
  );
}
