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
import type { AnnotatedSearchResult } from "./privacy.js";
import type { SyncIndex } from "./sync.js";
import {
  loadActivationIndex,
  saveActivationIndex,
  recordAccess,
  registerMemory,
  applyDecayRanking,
  computeDecayScore,
  classifyDecayTier,
  detectMemoryType,
  identifyPruneCandidates,
  removeEntries,
  type ActivationIndex,
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
import { registerMemoryTools } from "./tools.js";

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
      registerMemoryTools({
        api,
        cfg,
        client,
        getDatasetId: () => datasetId,
        setDatasetId: (id) => {
          datasetId = id;
        },
        activationIndex,
        stateReady,
        activationReady,
      });
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
          const decayScored = applyDecayRanking(
            filtered,
            activationIndex,
            cfg.typeWeights,
            cfg.decayRate,
          );
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
              const succeeded: string[] = [];
              for (const id of candidates) {
                try {
                  await client.delete({ dataId: id, datasetId });
                  succeeded.push(id);
                } catch (e) {
                  api.logger.warn?.(
                    `memory-cognee: auto-prune delete failed for ${id}: ${String(e)}`,
                  );
                }
              }
              if (succeeded.length > 0) {
                removeEntries(activationIndex, succeeded);
                api.logger.info?.(
                  `memory-cognee: auto-pruned ${succeeded.length} dormant memories`,
                );
              }
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

        // Reflection trigger
        if (cfg.reflectionEnabled && stmBuffer.turnsSinceReflection >= cfg.reflectionThreshold) {
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
