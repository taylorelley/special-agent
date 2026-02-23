/**
 * SpecialAgent Memory (Cognee) Plugin
 *
 * Cognee-backed memory: indexes workspace memory files into a knowledge graph,
 * auto-recalls relevant memories before agent runs, and auto-syncs file changes
 * after each agent turn.
 *
 * Supports three-tier scoped datasets (personal/project/team) when the scope
 * system is configured. Falls back to a single default dataset otherwise.
 *
 * Adapted from the official cognee-integrations/openclaw plugin:
 * https://github.com/topoteretes/cognee-integrations/tree/main/integrations/openclaw
 */

import type { SpecialAgentPluginApi } from "special-agent/plugin-sdk";
import { Type } from "@sinclair/typebox";
import type { AnnotatedSearchResult } from "./privacy.js";
import type { SyncIndex } from "./sync.js";
import {
  loadActivationIndex,
  saveActivationIndex,
  recordAccess,
  registerMemory,
  computeDecayScore,
  classifyDecayTier,
  detectMemoryType,
  identifyPruneCandidates,
  removeEntries,
  type ActivationIndex,
  type MemoryType,
} from "./activation.js";
import { CogneeClient, DEFAULT_DATASET_NAME, resolveConfig } from "./client.js";
import {
  loadStmBuffer,
  saveStmBuffer,
  extractConversationExcerpts,
  appendToStmBuffer,
  runConsolidation,
  runReflection,
  type StmBuffer,
} from "./consolidation.js";
import { filterRecallForPrivacy } from "./privacy.js";
import {
  collectMemoryFiles,
  loadDatasetState,
  loadSyncIndex,
  syncFiles,
  SYNC_INDEX_PATH,
} from "./sync.js";

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
    let activationIndex: ActivationIndex = { version: 1, entries: {} };
    let resolvedWorkspaceDir: string | undefined;

    // Both loadDatasetState and loadSyncIndex run in parallel. loadDatasetState
    // is authoritative for datasetId: it writes unconditionally, so if it resolves
    // second it intentionally overwrites any value set by loadSyncIndex. The
    // loadSyncIndex callback guards with !datasetId so it only fills in when
    // loadDatasetState hasn't provided a value yet.
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

    const activationReady = loadActivationIndex()
      .then((idx) => {
        activationIndex = idx;
      })
      .catch((error) => {
        api.logger.warn?.(`memory-cognee: failed to load activation index: ${String(error)}`);
      });

    // STM buffer for consolidation/reflection pipeline
    let stmBuffer: StmBuffer = {
      version: 1,
      entries: [],
      turnsSinceConsolidation: 0,
      turnsSinceReflection: 0,
    };

    const stmReady =
      cfg.consolidationEnabled || cfg.reflectionEnabled
        ? loadStmBuffer()
            .then((buf) => {
              stmBuffer = buf;
            })
            .catch((error) => {
              api.logger.warn?.(`memory-cognee: failed to load STM buffer: ${String(error)}`);
            })
        : Promise.resolve();

    async function runSync(
      workspaceDir: string,
      logger: { info?: (msg: string) => void; warn?: (msg: string) => void },
    ) {
      await Promise.all([stateReady, activationReady]);

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

      // Auto-classify synced files in activation index
      for (const file of files) {
        const entry = syncIndex.entries[file.path];
        if (entry?.dataId && !activationIndex.entries[entry.dataId]) {
          registerMemory(activationIndex, entry.dataId, detectMemoryType(file.content), {
            label: file.path,
            datasetName: cfg.datasetName,
          });
        }
      }
      saveActivationIndex(activationIndex).catch((e) => {
        logger.warn?.(`memory-cognee: failed to save activation index: ${String(e)}`);
      });

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
          .command("prune")
          .description("Remove dormant memories below decay threshold")
          .option("--threshold <n>", "Decay score threshold", String(cfg.pruneThreshold))
          .option("--dry-run", "Show candidates without deleting")
          .action(async (opts: { threshold: string; dryRun?: boolean }) => {
            await Promise.all([stateReady, activationReady]);

            const threshold = parseFloat(opts.threshold);
            const now = new Date();
            const candidates = identifyPruneCandidates(
              activationIndex,
              threshold,
              now,
              cfg.typeWeights,
              cfg.decayRate,
            );

            if (candidates.length === 0) {
              console.log("No dormant memories to prune.");
              return;
            }

            console.log(
              `Found ${candidates.length} dormant memories below threshold ${threshold}:`,
            );
            for (const id of candidates) {
              const entry = activationIndex.entries[id];
              if (!entry) continue;
              const score = computeDecayScore(entry, now, cfg.typeWeights, cfg.decayRate);
              console.log(
                `  [${id.slice(0, 8)}] ${entry.label ?? "?"} (score: ${score.toFixed(3)}, type: ${entry.memoryType})`,
              );
            }

            if (opts.dryRun) {
              console.log("Dry run — no changes made.");
              return;
            }

            if (datasetId) {
              for (const id of candidates) {
                try {
                  await client.delete({ dataId: id, datasetId });
                } catch (e) {
                  ctx.logger.warn?.(`memory-cognee: failed to delete ${id}: ${String(e)}`);
                }
              }
            }

            removeEntries(activationIndex, candidates);
            await saveActivationIndex(activationIndex);
            console.log(`Pruned ${candidates.length} dormant memories.`);
          });

        cognee
          .command("activation")
          .description("Show activation/decay status of indexed memories")
          .action(async () => {
            await activationReady;

            const now = new Date();
            const tiers: Record<string, number> = {
              active: 0,
              fading: 0,
              dormant: 0,
              archived: 0,
            };
            const types: Record<string, number> = {
              episodic: 0,
              semantic: 0,
              procedural: 0,
              vault: 0,
            };

            for (const entry of Object.values(activationIndex.entries)) {
              const score = computeDecayScore(entry, now, cfg.typeWeights, cfg.decayRate);
              const tier = classifyDecayTier(score);
              tiers[tier] = (tiers[tier] ?? 0) + 1;
              types[entry.memoryType] = (types[entry.memoryType] ?? 0) + 1;
            }

            const total = Object.keys(activationIndex.entries).length;
            const lines = [
              `Activation Index: ${total} entries`,
              "",
              `By tier: active=${tiers.active}, fading=${tiers.fading}, dormant=${tiers.dormant}, archived=${tiers.archived}`,
              `By type: episodic=${types.episodic}, semantic=${types.semantic}, procedural=${types.procedural}, vault=${types.vault}`,
            ];
            console.log(lines.join("\n"));
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

        cognee
          .command("stm")
          .description("Show STM buffer status")
          .action(async () => {
            await stmReady;

            const total = stmBuffer.entries.length;
            const consolidated = stmBuffer.entries.filter((e) => e.consolidated).length;
            const pending = total - consolidated;
            const lines = [
              `STM Buffer: ${total} entries (${consolidated} consolidated, ${pending} pending)`,
              `Turns since consolidation: ${stmBuffer.turnsSinceConsolidation}`,
              `Turns since reflection: ${stmBuffer.turnsSinceReflection}`,
              `Last consolidated: ${stmBuffer.lastConsolidatedAt ?? "(never)"}`,
              `Last reflected: ${stmBuffer.lastReflectedAt ?? "(never)"}`,
            ];
            console.log(lines.join("\n"));
          });

        cognee
          .command("consolidate")
          .description("Manually trigger STM-to-LTM consolidation")
          .option("--force", "Consolidate even with few entries")
          .action(async (opts: { force?: boolean }) => {
            await Promise.all([stateReady, activationReady, stmReady]);

            if (!cfg.consolidationEnabled && !opts.force) {
              console.log("Consolidation is disabled. Use --force or enable consolidationEnabled.");
              return;
            }

            const unconsolidated = stmBuffer.entries.filter((e) => !e.consolidated);
            if (unconsolidated.length === 0) {
              console.log("No unconsolidated STM entries.");
              return;
            }

            console.log(`Consolidating ${unconsolidated.length} STM entries...`);
            const count = await runConsolidation({
              buffer: stmBuffer,
              config: api.config,
              client,
              datasetId,
              datasetName: cfg.datasetName,
              activationIndex,
              logger: ctx.logger,
              autoCognify: cfg.autoCognify,
              timeoutMs: cfg.consolidationTimeoutMs,
              stmMaxAgeDays: cfg.stmMaxAgeDays,
            });
            await saveActivationIndex(activationIndex);
            console.log(`Consolidation complete: ${count} memories created.`);
          });

        cognee
          .command("reflect")
          .description("Manually trigger memory reflection")
          .option("--force", "Reflect even if threshold not met")
          .action(async (opts: { force?: boolean }) => {
            await Promise.all([stateReady, activationReady, stmReady]);

            if (!cfg.reflectionEnabled && !opts.force) {
              console.log("Reflection is disabled. Use --force or enable reflectionEnabled.");
              return;
            }

            const entryCount = Object.keys(activationIndex.entries).length;
            if (entryCount === 0) {
              console.log("No memories in activation index to reflect on.");
              return;
            }

            console.log(`Reflecting on ${entryCount} memories...`);
            const count = await runReflection({
              activationIndex,
              buffer: stmBuffer,
              config: api.config,
              client,
              datasetId,
              datasetName: cfg.datasetName,
              logger: ctx.logger,
              autoCognify: cfg.autoCognify,
              timeoutMs: cfg.reflectionTimeoutMs,
              typeWeights: cfg.typeWeights,
              decayRate: cfg.decayRate,
            });
            await saveActivationIndex(activationIndex);
            await saveStmBuffer(stmBuffer);
            console.log(`Reflection complete: ${count} insights generated.`);
          });
      },
      { commands: ["cognee"] },
    );

    // ------------------------------------------------------------------
    // Agent-facing tools: memory_recall, memory_store, memory_forget
    // ------------------------------------------------------------------

    if (cfg.enableTools) {
      const VALID_MEMORY_TYPES: MemoryType[] = ["episodic", "semantic", "procedural", "vault"];

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

            await Promise.all([stateReady, activationReady]);

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

            const now = new Date();
            let scored = results.map((r) => {
              const activation = activationIndex.entries[r.id];
              const decayScore = activation
                ? computeDecayScore(activation, now, cfg.typeWeights, cfg.decayRate)
                : 0.5;
              const clampedDecay = Number.isFinite(decayScore) ? Math.min(decayScore, 1) : 1;
              const combinedScore = r.score * (0.6 + 0.4 * clampedDecay);
              return { ...r, decayScore, combinedScore, activation };
            });

            if (memoryType) {
              scored = scored.filter((r) => r.activation?.memoryType === memoryType);
            }

            scored.sort((a, b) => b.combinedScore - a.combinedScore);
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
            pinned: Type.Optional(
              Type.Boolean({ description: "Pin this memory (immune to decay)" }),
            ),
            label: Type.Optional(Type.String({ description: "Short label for this memory" })),
          }),
          async execute(_toolCallId, params) {
            const { text, memoryType, pinned, label } = params as {
              text: string;
              memoryType?: MemoryType;
              pinned?: boolean;
              label?: string;
            };

            await Promise.all([stateReady, activationReady]);

            const resolvedType = memoryType ?? detectMemoryType(text);

            const response = await client.add({
              data: text,
              datasetName: cfg.datasetName,
              datasetId,
            });

            if (response.datasetId && response.datasetId !== datasetId) {
              datasetId = response.datasetId;
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

            if (cfg.autoCognify && datasetId) {
              try {
                await client.cognify({ datasetIds: [datasetId] });
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

      api.registerTool(
        {
          name: "memory_forget",
          label: "Memory Forget (Cognee)",
          description:
            "Remove specific memories from the knowledge graph. Search by query to find candidates, or specify an ID directly.",
          parameters: Type.Object({
            query: Type.Optional(
              Type.String({ description: "Search query to find memory to forget" }),
            ),
            memoryId: Type.Optional(Type.String({ description: "Specific memory ID to delete" })),
          }),
          async execute(_toolCallId, params) {
            const { query, memoryId } = params as { query?: string; memoryId?: string };

            await Promise.all([stateReady, activationReady]);

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

              if (results.length === 1 && results[0].score > 0.9) {
                const target = results[0];
                try {
                  await client.delete({ dataId: target.id, datasetId });
                } catch (e) {
                  api.logger.warn?.(`memory-cognee: Cognee delete failed: ${String(e)}`);
                }
                removeEntries(activationIndex, [target.id]);
                saveActivationIndex(activationIndex).catch((e) => {
                  api.logger.warn?.(`memory-cognee: failed to save activation index: ${String(e)}`);
                });
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: `Forgotten: "${target.text.slice(0, 80)}"`,
                    },
                  ],
                  details: { action: "deleted", id: target.id },
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
        await Promise.all([stateReady, activationReady]);

        if (!event.prompt || event.prompt.length < 5) {
          return;
        }
        if (!datasetId) {
          return;
        }

        try {
          // Determine which datasets to query based on scope context.
          // TODO: When multi-dataset Cognee provisioning is implemented, use
          // resolveRecallDatasets(scope) to map dataset names to Cognee IDs.
          // For now, query the single configured dataset ID.
          const scope = ctx.scope;
          const effectiveDatasetIds = [datasetId];

          const results = await client.search({
            queryText: event.prompt,
            searchType: cfg.searchType,
            datasetIds: effectiveDatasetIds,
            topK: cfg.maxResults * 2,
          });

          let filtered = results.filter((result) => result.score >= cfg.minScore);

          // Apply privacy filter when scope is available.
          // Skip for the legacy single dataset ("special-agent") since it
          // doesn't follow the scoped naming convention and would be
          // conservatively excluded by classifyDataset in group sessions.
          if (scope && scope.isGroupSession && cfg.datasetName !== DEFAULT_DATASET_NAME) {
            const annotated: AnnotatedSearchResult[] = filtered.map((r) => ({
              ...r,
              sourceDataset: cfg.datasetName,
            }));
            filtered = filterRecallForPrivacy(annotated, scope);
          }

          if (filtered.length === 0) {
            return;
          }

          // Apply decay scoring to re-rank results
          const now = new Date();
          const decayScored = filtered.map((result) => {
            const activation = activationIndex.entries[result.id];
            const decayScore = activation
              ? computeDecayScore(activation, now, cfg.typeWeights, cfg.decayRate)
              : 0.5;
            const clampedDecay = Number.isFinite(decayScore) ? Math.min(decayScore, 1) : 1;
            const combinedScore = result.score * (0.6 + 0.4 * clampedDecay);
            return { ...result, decayScore, combinedScore };
          });
          decayScored.sort((a, b) => b.combinedScore - a.combinedScore);
          const topResults = decayScored.slice(0, cfg.maxResults);

          // Record access for recalled memories (async, non-blocking)
          for (const r of topResults) {
            recordAccess(activationIndex, r.id);
          }
          saveActivationIndex(activationIndex).catch((e) => {
            api.logger.warn?.(`memory-cognee: failed to save activation index: ${String(e)}`);
          });

          const payload = JSON.stringify(
            topResults.map((result) => ({
              id: result.id,
              score: result.score,
              decayScore: result.decayScore,
              memoryType: activationIndex.entries[result.id]?.memoryType ?? "unknown",
              decayTier: activationIndex.entries[result.id]
                ? classifyDecayTier(result.decayScore)
                : "unknown",
              text: result.text,
              metadata: result.metadata,
            })),
            null,
            2,
          );

          api.logger.info?.(
            `memory-cognee: injecting ${topResults.length} memories for session ${ctx.sessionKey ?? "unknown"}`,
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
      api.on("agent_end", async (event, ctx) => {
        if (!event.success) return;

        await Promise.all([stateReady, activationReady]);

        const workspaceDir = resolvedWorkspaceDir || process.cwd();

        try {
          const files = await collectMemoryFiles(workspaceDir);
          const changedFiles = files.filter((f) => {
            const existing = syncIndex.entries[f.path];
            return !existing || existing.hash !== f.hash;
          });

          if (changedFiles.length > 0) {
            api.logger.info?.(
              `memory-cognee: detected ${changedFiles.length} changed file(s), syncing...`,
            );

            const result = await syncFiles(client, changedFiles, syncIndex, cfg, api.logger);
            if (result.datasetId) {
              datasetId = result.datasetId;
            }

            // Auto-classify newly synced files
            for (const file of changedFiles) {
              const entry = syncIndex.entries[file.path];
              if (entry?.dataId && !activationIndex.entries[entry.dataId]) {
                registerMemory(activationIndex, entry.dataId, detectMemoryType(file.content), {
                  label: file.path,
                  datasetName: cfg.datasetName,
                });
              }
            }

            api.logger.info?.(
              `memory-cognee: post-agent sync: ${result.added} added, ${result.updated} updated`,
            );
          }

          // Auto-prune dormant memories
          if (cfg.autoPrune) {
            const candidates = identifyPruneCandidates(
              activationIndex,
              cfg.pruneThreshold,
              new Date(),
              cfg.typeWeights,
              cfg.decayRate,
            );
            if (candidates.length > 0 && datasetId) {
              for (const id of candidates) {
                try {
                  await client.delete({ dataId: id, datasetId });
                } catch {
                  // Cognee delete may not be available; continue with local cleanup
                }
              }
              removeEntries(activationIndex, candidates);
              api.logger.info?.(`memory-cognee: auto-pruned ${candidates.length} dormant memories`);
            }
          }

          saveActivationIndex(activationIndex).catch((e) => {
            api.logger.warn?.(`memory-cognee: failed to save activation index: ${String(e)}`);
          });
        } catch (error) {
          api.logger.warn?.(`memory-cognee: post-agent sync failed: ${String(error)}`);
        }

        // STM capture + consolidation/reflection (within autoIndex agent_end)
        await captureAndConsolidate(event, ctx);
      });
    }

    // ------------------------------------------------------------------
    // STM capture + consolidation/reflection (standalone when autoIndex off)
    // ------------------------------------------------------------------

    if (!cfg.autoIndex && (cfg.consolidationEnabled || cfg.reflectionEnabled)) {
      api.on("agent_end", async (event, ctx) => {
        if (!event.success) return;
        await captureAndConsolidate(event, ctx);
      });
    }

    async function captureAndConsolidate(
      event: { messages: unknown[] },
      ctx: { sessionKey?: string },
    ) {
      if (!cfg.consolidationEnabled && !cfg.reflectionEnabled) return;

      try {
        await stmReady;
        const excerpts = extractConversationExcerpts(event.messages);
        if (excerpts.userExcerpts.length === 0 && excerpts.assistantExcerpts.length === 0) {
          return;
        }

        appendToStmBuffer(stmBuffer, excerpts, ctx.sessionKey);

        // Consolidation trigger
        if (
          cfg.consolidationEnabled &&
          stmBuffer.turnsSinceConsolidation >= cfg.consolidationThreshold
        ) {
          // Skip LLM calls in test environments
          if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
            const count = await runConsolidation({
              buffer: stmBuffer,
              config: api.config,
              client,
              datasetId,
              datasetName: cfg.datasetName,
              activationIndex,
              logger: api.logger,
              autoCognify: cfg.autoCognify,
              timeoutMs: cfg.consolidationTimeoutMs,
              stmMaxAgeDays: cfg.stmMaxAgeDays,
            });
            if (count > 0) {
              api.logger.info?.(`memory-cognee: consolidated ${count} memories from STM`);
              saveActivationIndex(activationIndex).catch((e) => {
                api.logger.warn?.(`memory-cognee: failed to save activation index: ${String(e)}`);
              });
            }
          }
        }

        // Reflection trigger
        if (cfg.reflectionEnabled && stmBuffer.turnsSinceReflection >= cfg.reflectionThreshold) {
          if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
            const count = await runReflection({
              activationIndex,
              buffer: stmBuffer,
              config: api.config,
              client,
              datasetId,
              datasetName: cfg.datasetName,
              logger: api.logger,
              autoCognify: cfg.autoCognify,
              timeoutMs: cfg.reflectionTimeoutMs,
              typeWeights: cfg.typeWeights,
              decayRate: cfg.decayRate,
            });
            if (count > 0) {
              api.logger.info?.(`memory-cognee: reflection generated ${count} insights`);
              saveActivationIndex(activationIndex).catch((e) => {
                api.logger.warn?.(`memory-cognee: failed to save activation index: ${String(e)}`);
              });
            }
          }
        }

        saveStmBuffer(stmBuffer).catch((e) => {
          api.logger.warn?.(`memory-cognee: failed to save STM buffer: ${String(e)}`);
        });
      } catch (error) {
        api.logger.warn?.(`memory-cognee: STM/consolidation failed: ${String(error)}`);
      }
    }
  },
};

export default memoryCogneePlugin;
