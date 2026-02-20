import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SpecialAgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardFlow } from "../wizard/onboarding.types.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { resolveBundledPluginsDir } from "../plugins/bundled-dir.js";
import { checkDocker, type DockerStatus } from "../process/docker.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { restoreTerminalState } from "../terminal/restore.js";
import { CONFIG_DIR } from "../utils.js";
import { fetchEndpointModels } from "./model-picker.js";
import { OLLAMA_DEFAULT_BASE_URL, OLLAMA_PROVIDER_ID } from "./onboard-ollama.js";

function getCogneeComposeSource(): string {
  const extensionsDir = resolveBundledPluginsDir();
  if (!extensionsDir) {
    throw new Error("Could not locate extensions directory");
  }
  return path.join(extensionsDir, "memory-cognee", "cognee-docker-compose.yaml");
}

const COGNEE_STATE_DIR = path.join(CONFIG_DIR, "cognee");
const COGNEE_COMPOSE_DEST = path.join(COGNEE_STATE_DIR, "cognee-docker-compose.yaml");
const COGNEE_CONTAINER_NAME = "cognee";
const COGNEE_BASE_URL = "http://localhost:8000";
const COGNEE_HEALTH_URL = `${COGNEE_BASE_URL}/health`;
const HEALTH_CHECK_INTERVAL_MS = 2_000;
const HEALTH_CHECK_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Cognee model configuration types
// ---------------------------------------------------------------------------

type CogneeModelConfig = {
  provider: string; // cognee provider value: "custom" | "ollama"
  endpoint: string; // base URL
  apiKey: string;
  model: string;
};

type CogneeLlmConfig = {
  llm: CogneeModelConfig;
  embedding: CogneeModelConfig;
};

// ---------------------------------------------------------------------------
// Docker helpers
// ---------------------------------------------------------------------------

/**
 * Offers to add the current user to the `docker` group via sudo.
 * Returns `true` if we showed a message (caller should skip the generic fallback).
 */
async function offerDockerGroupFix(prompter: WizardPrompter): Promise<boolean> {
  const addToGroup = await prompter.confirm({
    message: "Add your user to the docker group? (requires sudo)",
    initialValue: true,
  });
  if (!addToGroup) {
    return false;
  }

  const username = os.userInfo().username;

  // Restore terminal to a sane state (cursor visible, ANSI modes reset) and
  // then pause stdin.  @clack/prompts leaves stdin paused after each prompt
  // (via readline.close()), but restoreTerminalState resumes it.  We need it
  // paused so Node's emitKeypressEvents data handler doesn't compete with sudo
  // for terminal input on fd 0.
  restoreTerminalState("pre-docker-usermod");
  process.stdin.pause();

  const result = spawnSync("sudo", ["usermod", "-aG", "docker", username], {
    stdio: "inherit",
  });

  if (result.error) {
    await prompter.note(
      [
        `Failed to run sudo: ${String(result.error)}`,
        `Run manually: sudo usermod -aG docker ${username}`,
        "",
        "Falling back to Core memory.",
      ].join("\n"),
      "Memory",
    );
    return true;
  }

  if (result.status === 0) {
    await prompter.note(
      [
        `Added ${username} to the docker group.`,
        "Log out and back in (or restart your terminal) for the change to take effect,",
        "then re-run the setup wizard.",
        "",
        "Falling back to Core memory for now.",
      ].join("\n"),
      "Memory",
    );
    return true;
  }

  await prompter.note(
    [
      "Failed to add user to the docker group.",
      `Run manually: sudo usermod -aG docker ${username}`,
      "",
      "Falling back to Core memory.",
    ].join("\n"),
    "Memory",
  );
  return true;
}

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

async function startCogneeContainer(
  config: CogneeLlmConfig,
): Promise<{ ok: boolean; error?: string }> {
  await fs.mkdir(COGNEE_STATE_DIR, { recursive: true });

  try {
    const source = await fs.readFile(getCogneeComposeSource(), "utf-8");
    await fs.writeFile(COGNEE_COMPOSE_DEST, source, "utf-8");
  } catch (err) {
    return { ok: false, error: `Failed to copy docker-compose file: ${String(err)}` };
  }

  const env: Record<string, string> = {
    LLM_PROVIDER: config.llm.provider,
    LLM_ENDPOINT: config.llm.endpoint,
    LLM_MODEL: config.llm.model,
    LLM_API_KEY: config.llm.apiKey,
    EMBEDDING_PROVIDER: config.embedding.provider,
    EMBEDDING_ENDPOINT: config.embedding.endpoint,
    EMBEDDING_MODEL: config.embedding.model,
    EMBEDDING_API_KEY: config.embedding.apiKey,
  };

  try {
    const result = await runCommandWithTimeout(
      ["docker", "compose", "-f", COGNEE_COMPOSE_DEST, "up", "-d"],
      { timeoutMs: 120_000, env },
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
// Agent model extraction
// ---------------------------------------------------------------------------

function extractAgentModelConfig(cfg: SpecialAgentConfig): CogneeModelConfig | undefined {
  const primary = cfg.agents?.defaults?.model?.primary;
  if (!primary || typeof primary !== "string") {
    return undefined;
  }
  const slashIdx = primary.indexOf("/");
  if (slashIdx < 0) {
    return undefined;
  }
  const providerId = primary.slice(0, slashIdx);
  const modelId = primary.slice(slashIdx + 1);
  const provider = cfg.models?.providers?.[providerId];
  if (!provider || !provider.baseUrl) {
    return undefined;
  }
  const apiKey = provider.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey && providerId !== OLLAMA_PROVIDER_ID) {
    return undefined;
  }
  const cogneeProvider = providerId === OLLAMA_PROVIDER_ID ? "ollama" : "custom";
  return { provider: cogneeProvider, endpoint: provider.baseUrl, apiKey, model: modelId };
}

// ---------------------------------------------------------------------------
// Cognee model prompts
// ---------------------------------------------------------------------------

async function promptEndpointConfig(
  prompter: WizardPrompter,
  label: string,
  defaults?: CogneeModelConfig,
): Promise<CogneeModelConfig> {
  const providerType = await prompter.select({
    message: `${label} endpoint type`,
    options: [
      { value: "openai", label: "OpenAI Compatible API", hint: "Uses /chat/completions" },
      { value: "anthropic", label: "Anthropic Compatible API", hint: "Uses /messages" },
      { value: "ollama", label: "Ollama Compatible API", hint: "Local models, no API key needed" },
    ],
    initialValue: "openai" as string,
  });
  const cogneeProvider = providerType === "ollama" ? "ollama" : "custom";
  const isOllama = providerType === "ollama";

  const endpoint = await prompter.text({
    message: `${label} endpoint URL`,
    ...(defaults?.endpoint
      ? { initialValue: defaults.endpoint }
      : { placeholder: isOllama ? OLLAMA_DEFAULT_BASE_URL : "https://api.openai.com/v1" }),
  });

  const apiKey = await prompter.text({
    message: `${label} API key`,
    ...(defaults?.apiKey
      ? { initialValue: defaults.apiKey }
      : { placeholder: isOllama ? "(optional)" : "sk-..." }),
    validate: isOllama
      ? undefined
      : (val) => {
          if (!val.trim()) {
            return `An API key is required for ${label}`;
          }
          return undefined;
        },
  });

  let model: string;
  const spinner = prompter.progress(`Fetching ${label} models...`);
  try {
    const models = await fetchEndpointModels(endpoint, apiKey);
    spinner.stop(`Found ${models.length} model(s).`);
    if (models.length > 0) {
      model = await prompter.select({
        message: `${label} model`,
        options: models.map((m) => ({
          value: m.id,
          label: m.name ?? m.id,
        })),
        initialValue: defaults?.model ?? models[0].id,
      });
    } else {
      model = await prompter.text({
        message: `${label} model ID`,
        ...(defaults?.model ? { initialValue: defaults.model } : {}),
      });
    }
  } catch {
    spinner.stop(`Could not fetch ${label} models.`);
    model = await prompter.text({
      message: `${label} model ID (enter manually)`,
      ...(defaults?.model ? { initialValue: defaults.model } : {}),
    });
  }

  return { provider: cogneeProvider, endpoint, apiKey, model };
}

async function promptEmbeddingModel(
  prompter: WizardPrompter,
  llmConfig: CogneeModelConfig,
): Promise<CogneeModelConfig> {
  const spinner = prompter.progress("Fetching embedding models...");
  try {
    const models = await fetchEndpointModels(llmConfig.endpoint, llmConfig.apiKey);
    spinner.stop(`Found ${models.length} model(s).`);
    if (models.length > 0) {
      const model = await prompter.select({
        message: "Embedding model",
        options: models.map((m) => ({
          value: m.id,
          label: m.name ?? m.id,
        })),
        initialValue: models[0].id,
      });
      return {
        provider: llmConfig.provider,
        endpoint: llmConfig.endpoint,
        apiKey: llmConfig.apiKey,
        model,
      };
    }
  } catch {
    spinner.stop("Could not fetch embedding models.");
  }
  const model = await prompter.text({
    message: "Embedding model ID (enter manually)",
  });
  return {
    provider: llmConfig.provider,
    endpoint: llmConfig.endpoint,
    apiKey: llmConfig.apiKey,
    model,
  };
}

async function resolveCogneeLlmConfig(
  cfg: SpecialAgentConfig,
  prompter: WizardPrompter,
  _flow: WizardFlow,
): Promise<CogneeLlmConfig> {
  // --- LLM ---
  let llm: CogneeModelConfig;
  const agentConfig = extractAgentModelConfig(cfg);

  if (agentConfig) {
    const reuse = await prompter.select({
      message: "LLM for Cognee",
      options: [
        {
          value: "reuse",
          label: `Reuse agent model (${agentConfig.endpoint}/${agentConfig.model})`,
        },
        { value: "different", label: "Configure a different LLM" },
      ],
      initialValue: "reuse" as string,
    });
    llm = reuse === "reuse" ? agentConfig : await promptEndpointConfig(prompter, "LLM");
  } else {
    llm = await promptEndpointConfig(prompter, "LLM");
  }

  // --- Embedding ---
  let embedding: CogneeModelConfig;
  const embeddingChoice = await prompter.select({
    message: "Embedding model",
    options: [
      { value: "same", label: "Same endpoint as LLM" },
      { value: "different", label: "Configure a different endpoint" },
    ],
    initialValue: "same" as string,
  });

  if (embeddingChoice === "same") {
    embedding = await promptEmbeddingModel(prompter, llm);
  } else {
    embedding = await promptEndpointConfig(prompter, "Embedding");
  }

  return { llm, embedding };
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

function buildCogneePluginConfig(
  details: CogneeDetails,
  llm?: CogneeLlmConfig,
): Record<string, unknown> {
  return {
    baseUrl: COGNEE_BASE_URL,
    datasetName: details.datasetName,
    searchType: details.searchType,
    maxResults: details.maxResults,
    autoRecall: details.autoRecall,
    autoIndex: true,
    autoCognify: details.autoCognify,
    ...(llm && {
      llmEndpoint: llm.llm.endpoint,
      llmModel: llm.llm.model,
      embeddingEndpoint: llm.embedding.endpoint,
      embeddingModel: llm.embedding.model,
    }),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SetupMemoryOptions = { dockerStatus?: DockerStatus };

export async function setupMemory(
  cfg: SpecialAgentConfig,
  _workspaceDir: string,
  _runtime: RuntimeEnv,
  prompter: WizardPrompter,
  flow: WizardFlow,
  options?: SetupMemoryOptions,
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

  const docker = options?.dockerStatus ?? (await checkDocker());
  if (!docker.available) {
    dockerSpinner.stop(docker.installed ? "Docker not ready." : "Docker not found.");

    // On Linux, offer to fix permission denied by adding the user to the docker group.
    if (
      docker.installed &&
      docker.reason?.includes("Permission denied") &&
      process.platform === "linux"
    ) {
      const handled = await offerDockerGroupFix(prompter);
      if (handled) {
        return cfg;
      }
    }

    const lines = ["Cognee requires a working Docker installation."];
    if (docker.reason) {
      lines.push(docker.reason);
    }
    if (!docker.installed) {
      lines.push("Install Docker: https://docs.docker.com/get-docker/");
    }
    lines.push("", "Falling back to Core memory.");
    await prompter.note(lines.join("\n"), "Memory");
    return cfg;
  }

  const alreadyRunning = await isCogneeContainerRunning();
  if (alreadyRunning) {
    dockerSpinner.stop("Cognee container already running.");
    const details = await promptCogneeDetails(prompter, flow);
    return applyMemorySlot(cfg, "memory-cognee", buildCogneePluginConfig(details));
  }

  dockerSpinner.stop("Docker available.");

  const cogneeLlm = await resolveCogneeLlmConfig(cfg, prompter, flow);

  const startSpinner = prompter.progress("Starting cognee container...");
  const startResult = await startCogneeContainer(cogneeLlm);
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
  return applyMemorySlot(cfg, "memory-cognee", buildCogneePluginConfig(details, cogneeLlm));
}
