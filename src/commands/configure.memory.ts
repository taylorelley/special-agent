import type { SpecialAgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { confirm, select, text } from "./configure.shared.js";
import { guardCancel } from "./onboard-helpers.js";
import { applyMemorySlot } from "./onboard-memory.js";

export async function promptMemoryConfig(
  nextConfig: SpecialAgentConfig,
  runtime: RuntimeEnv,
): Promise<SpecialAgentConfig> {
  const currentSlot = nextConfig.plugins?.slots?.memory ?? "memory-core";

  const memoryChoice = guardCancel(
    await select({
      message: "Memory system",
      options: [
        {
          value: "memory-core",
          label: "Core (file-backed SQLite)",
          hint: "Default, no extra deps",
        },
        {
          value: "memory-cognee",
          label: "Cognee (knowledge graph)",
          hint: "Requires Docker",
        },
        { value: "none", label: "No memory" },
      ],
      initialValue: currentSlot,
    }),
    runtime,
  );

  if (memoryChoice === "none") {
    return applyMemorySlot(nextConfig, null);
  }

  if (memoryChoice === "memory-core") {
    return applyMemorySlot(nextConfig, "memory-core");
  }

  // Cognee selected — prompt for details
  const existingConfig = nextConfig.plugins?.entries?.["memory-cognee"]?.config ?? {};
  const existingDataset =
    typeof existingConfig.datasetName === "string" ? existingConfig.datasetName : "special-agent";
  const existingSearchType =
    typeof existingConfig.searchType === "string" ? existingConfig.searchType : "GRAPH_COMPLETION";
  const existingMaxResults =
    typeof existingConfig.maxResults === "number" ? String(existingConfig.maxResults) : "6";
  const existingAutoRecall =
    typeof existingConfig.autoRecall === "boolean" ? existingConfig.autoRecall : true;
  const existingAutoCognify =
    typeof existingConfig.autoCognify === "boolean" ? existingConfig.autoCognify : true;

  const datasetName = guardCancel(
    await text({
      message: "Cognee dataset name",
      initialValue: existingDataset,
    }),
    runtime,
  );

  const searchType = guardCancel(
    await select({
      message: "Cognee search type",
      options: [
        { value: "GRAPH_COMPLETION", label: "Graph Completion", hint: "Default" },
        { value: "CHUNKS", label: "Chunks" },
        { value: "SUMMARIES", label: "Summaries" },
      ],
      initialValue: existingSearchType,
    }),
    runtime,
  );

  const maxResultsRaw = String(
    guardCancel(
      await text({
        message: "Max recall results",
        initialValue: existingMaxResults,
        validate: (val) => {
          const n = parseInt(val ?? "", 10);
          if (isNaN(n) || n <= 0) {
            return "Please enter a positive integer";
          }
          return undefined;
        },
      }),
      runtime,
    ),
  );
  const maxResults = parseInt(maxResultsRaw, 10);

  const autoRecall = guardCancel(
    await confirm({
      message: "Enable auto-recall?",
      initialValue: existingAutoRecall,
    }),
    runtime,
  );

  const autoCognify = guardCancel(
    await confirm({
      message: "Enable auto-cognify?",
      initialValue: existingAutoCognify,
    }),
    runtime,
  );

  return applyMemorySlot(nextConfig, "memory-cognee", {
    baseUrl: "http://localhost:8000",
    datasetName: String(datasetName),
    searchType,
    maxResults,
    autoRecall,
    autoIndex: true,
    autoCognify,
  });
}
