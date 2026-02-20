import fs from "node:fs/promises";
import path from "node:path";
import type { SpecialAgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardFlow } from "../wizard/onboarding.types.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { isDockerAvailable } from "../process/docker.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { CONFIG_DIR } from "../utils.js";

const COGNEE_COMPOSE_SOURCE = path.resolve(
  import.meta.dirname ?? __dirname,
  "..",
  "..",
  "extensions",
  "memory-cognee",
  "cognee-docker-compose.yaml",
);

const COGNEE_STATE_DIR = path.join(CONFIG_DIR, "cognee");
const COGNEE_COMPOSE_DEST = path.join(COGNEE_STATE_DIR, "cognee-docker-compose.yaml");
const COGNEE_CONTAINER_NAME = "cognee";
const COGNEE_BASE_URL = "http://localhost:8000";
const COGNEE_HEALTH_URL = `${COGNEE_BASE_URL}/health`;
const HEALTH_CHECK_INTERVAL_MS = 2_000;
const HEALTH_CHECK_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Docker helpers
// ---------------------------------------------------------------------------

async function isCogneeContainerRunning(): Promise<boolean> {
  try {
    const result = await runCommandWithTimeout(
      ["docker", "ps", "--filter", `name=${COGNEE_CONTAINER_NAME}`, "--format", "{{.Names}}"],
      10_000,
    );
    return result.code === 0 && result.stdout.includes(COGNEE_CONTAINER_NAME);
  } catch {
    return false;
  }
}

async function startCogneeContainer(llmApiKey: string): Promise<{ ok: boolean; error?: string }> {
  await fs.mkdir(COGNEE_STATE_DIR, { recursive: true });

  try {
    const source = await fs.readFile(COGNEE_COMPOSE_SOURCE, "utf-8");
    await fs.writeFile(COGNEE_COMPOSE_DEST, source, "utf-8");
  } catch (err) {
    return { ok: false, error: `Failed to copy docker-compose file: ${String(err)}` };
  }

  try {
    const result = await runCommandWithTimeout(
      ["docker", "compose", "-f", COGNEE_COMPOSE_DEST, "up", "-d"],
      {
        timeoutMs: 120_000,
        env: { LLM_API_KEY: llmApiKey },
      },
    );
    if (result.code !== 0) {
      const stderr = result.stderr.trim();
      return { ok: false, error: `docker compose failed (exit ${result.code}): ${stderr}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Failed to start cognee container: ${String(err)}` };
  }
}

async function waitForCogneeHealth(): Promise<boolean> {
  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(COGNEE_HEALTH_URL, { signal: controller.signal });
      if (response.ok) {
        return true;
      }
    } catch {
      // Not ready yet
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
  }
  return false;
}

// ---------------------------------------------------------------------------
// LLM API key extraction
// ---------------------------------------------------------------------------

function extractLlmApiKey(cfg: SpecialAgentConfig): string | undefined {
  const providers = cfg.models?.providers;
  if (!providers) {
    return undefined;
  }
  for (const provider of Object.values(providers)) {
    if (provider && typeof provider === "object" && "apiKey" in provider) {
      const key = (provider as Record<string, unknown>).apiKey;
      if (typeof key === "string" && key.length > 0) {
        return key;
      }
    }
  }
  return process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || undefined;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function applyMemorySlot(
  cfg: SpecialAgentConfig,
  slotId: string | null,
  pluginConfig?: Record<string, unknown>,
): SpecialAgentConfig {
  const slotValue = slotId ?? "none";
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      slots: { ...cfg.plugins?.slots, memory: slotValue },
      ...(pluginConfig && slotId
        ? {
            entries: {
              ...cfg.plugins?.entries,
              [slotId]: { enabled: true, config: pluginConfig },
            },
          }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Cognee detail prompts
// ---------------------------------------------------------------------------

type CogneeDetails = {
  datasetName: string;
  searchType: string;
  maxResults: number;
  autoRecall: boolean;
  autoCognify: boolean;
};

async function promptCogneeDetails(
  prompter: WizardPrompter,
  flow: WizardFlow,
): Promise<CogneeDetails> {
  if (flow === "quickstart") {
    return {
      datasetName: "special-agent",
      searchType: "GRAPH_COMPLETION",
      maxResults: 6,
      autoRecall: true,
      autoCognify: true,
    };
  }

  const datasetName = await prompter.text({
    message: "Cognee dataset name",
    initialValue: "special-agent",
  });

  const searchType = await prompter.select({
    message: "Cognee search type",
    options: [
      { value: "GRAPH_COMPLETION", label: "Graph Completion", hint: "Default" },
      { value: "CHUNKS", label: "Chunks" },
      { value: "SUMMARIES", label: "Summaries" },
    ],
    initialValue: "GRAPH_COMPLETION",
  });

  const maxResultsRaw = await prompter.text({
    message: "Max recall results",
    initialValue: "6",
    validate: (val) => {
      const n = parseInt(val, 10);
      if (isNaN(n) || n <= 0) {
        return "Please enter a positive integer";
      }
      return undefined;
    },
  });
  const maxResults = parseInt(maxResultsRaw, 10);

  const autoRecall = await prompter.confirm({
    message: "Enable auto-recall?",
    initialValue: true,
  });

  const autoCognify = await prompter.confirm({
    message: "Enable auto-cognify?",
    initialValue: true,
  });

  return { datasetName, searchType, maxResults, autoRecall, autoCognify };
}

function buildCogneePluginConfig(details: CogneeDetails): Record<string, unknown> {
  return {
    baseUrl: COGNEE_BASE_URL,
    datasetName: details.datasetName,
    searchType: details.searchType,
    maxResults: details.maxResults,
    autoRecall: details.autoRecall,
    autoIndex: true,
    autoCognify: details.autoCognify,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function setupMemory(
  cfg: SpecialAgentConfig,
  _workspaceDir: string,
  _runtime: RuntimeEnv,
  prompter: WizardPrompter,
  flow: WizardFlow,
): Promise<SpecialAgentConfig> {
  const memoryChoice = await prompter.select({
    message: "Memory system",
    options: [
      { value: "memory-core", label: "Core (file-backed SQLite)", hint: "Default, no extra deps" },
      {
        value: "memory-cognee",
        label: "Cognee (knowledge graph)",
        hint: "Requires Docker, auto-configured",
      },
      { value: "none", label: "No memory" },
    ],
    initialValue: "memory-core",
  });

  if (memoryChoice === "none") {
    return applyMemorySlot(cfg, null);
  }

  if (memoryChoice === "memory-core") {
    // Keep the default — no config change needed for the slot
    return cfg;
  }

  // --- Cognee selected: automatic Docker setup ---

  const dockerSpinner = prompter.progress("Checking Docker...");

  const dockerOk = await isDockerAvailable();
  if (!dockerOk) {
    dockerSpinner.stop("Docker not found.");
    await prompter.note(
      [
        "Cognee requires Docker to run.",
        "Install Docker: https://docs.docker.com/get-docker/",
        "",
        "Falling back to Core memory.",
      ].join("\n"),
      "Memory",
    );
    return cfg;
  }

  const alreadyRunning = await isCogneeContainerRunning();
  if (alreadyRunning) {
    dockerSpinner.stop("Cognee container already running.");
    const details = await promptCogneeDetails(prompter, flow);
    return applyMemorySlot(cfg, "memory-cognee", buildCogneePluginConfig(details));
  }

  dockerSpinner.stop("Docker available.");

  // Get LLM API key for cognee
  let llmApiKey = extractLlmApiKey(cfg);
  if (!llmApiKey) {
    llmApiKey = await prompter.text({
      message: "LLM API key for Cognee (e.g. OpenAI key)",
      placeholder: "sk-...",
      validate: (val) => {
        if (!val.trim()) {
          return "An API key is required for Cognee";
        }
        return undefined;
      },
    });
  }

  const startSpinner = prompter.progress("Starting cognee container...");
  const startResult = await startCogneeContainer(llmApiKey);
  if (!startResult.ok) {
    startSpinner.stop("Failed to start cognee.");
    await prompter.note(
      [
        `Error: ${startResult.error}`,
        "",
        "Falling back to Core memory.",
        "You can retry later with: docker compose -f ~/.special-agent/cognee/cognee-docker-compose.yaml up -d",
      ].join("\n"),
      "Memory",
    );
    return cfg;
  }

  startSpinner.stop("Cognee container started.");

  const healthSpinner = prompter.progress("Waiting for cognee to be ready...");
  const healthy = await waitForCogneeHealth();
  if (!healthy) {
    healthSpinner.stop("Cognee health check timed out.");
    await prompter.note(
      [
        "Cognee did not become healthy within 60 seconds.",
        "Check logs: docker logs cognee",
        "",
        "The container is running but may need more time.",
        "Configuring cognee anyway — it should work once ready.",
      ].join("\n"),
      "Memory",
    );
  } else {
    healthSpinner.stop("Cognee is ready.");
  }

  const details = await promptCogneeDetails(prompter, flow);
  return applyMemorySlot(cfg, "memory-cognee", buildCogneePluginConfig(details));
}
