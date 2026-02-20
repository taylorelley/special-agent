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
import { CogneeClient, resolveConfig } from "./client.js";
import { filterRecallForPrivacy } from "./privacy.js";
import { resolveRecallDatasets } from "./scoped-datasets.js";
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
    let resolvedWorkspaceDir: string | undefined;

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

    async function runSync(
      workspaceDir: string,
      logger: { info?: (msg: string) => void; warn?: (msg: string) => void },
    ) {
      await stateReady;

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
      },
      { commands: ["cognee"] },
    );

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
        await stateReady;

        if (!event.prompt || event.prompt.length < 5) {
          return;
        }
        if (!datasetId) {
          return;
        }

        try {
          // Determine which datasets to query based on scope context.
          // When scope is available, resolveRecallDatasets returns dataset names
          // per the privacy rules. For now, we still query the single configured
          // dataset ID until multi-dataset Cognee provisioning is implemented.
          const scope = ctx.scope;
          const _recallDatasetNames = scope ? resolveRecallDatasets(scope) : undefined;

          // TODO: map dataset names to Cognee dataset IDs once multi-dataset
          // provisioning is implemented. For now, use the single configured ID.
          const effectiveDatasetIds = [datasetId];

          const results = await client.search({
            queryText: event.prompt,
            searchType: cfg.searchType,
            datasetIds: effectiveDatasetIds,
            maxTokens: cfg.maxTokens,
          });

          let filtered = results
            .filter((result) => result.score >= cfg.minScore)
            .slice(0, cfg.maxResults);

          // Apply privacy filter when scope is available.
          // Skip for the legacy single dataset ("special-agent") since it
          // doesn't follow the scoped naming convention and would be
          // conservatively excluded by classifyDataset in group sessions.
          if (scope && scope.isGroupSession && cfg.datasetName !== "special-agent") {
            const annotated: AnnotatedSearchResult[] = filtered.map((r) => ({
              ...r,
              sourceDataset: cfg.datasetName,
            }));
            filtered = filterRecallForPrivacy(annotated, scope);
          }

          if (filtered.length === 0) {
            return;
          }

          const payload = JSON.stringify(
            filtered.map((result) => ({
              id: result.id,
              score: result.score,
              text: result.text,
              metadata: result.metadata,
            })),
            null,
            2,
          );

          api.logger.info?.(
            `memory-cognee: injecting ${filtered.length} memories for session ${ctx.sessionKey ?? "unknown"}`,
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
      api.on("agent_end", async (event) => {
        if (!event.success) return;

        await stateReady;

        const workspaceDir = resolvedWorkspaceDir || process.cwd();

        try {
          const files = await collectMemoryFiles(workspaceDir);
          const changedFiles = files.filter((f) => {
            const existing = syncIndex.entries[f.path];
            return !existing || existing.hash !== f.hash;
          });

          if (changedFiles.length === 0) return;

          api.logger.info?.(
            `memory-cognee: detected ${changedFiles.length} changed file(s), syncing...`,
          );

          const result = await syncFiles(client, changedFiles, syncIndex, cfg, api.logger);
          if (result.datasetId) {
            datasetId = result.datasetId;
          }

          api.logger.info?.(
            `memory-cognee: post-agent sync: ${result.added} added, ${result.updated} updated`,
          );
        } catch (error) {
          api.logger.warn?.(`memory-cognee: post-agent sync failed: ${String(error)}`);
        }
      });
    }
  },
};

export default memoryCogneePlugin;
