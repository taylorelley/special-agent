import { type SpawnSyncReturns } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpecialAgentConfig } from "../config/config.js";
import type { WizardPrompter } from "../wizard/prompts.js";

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted so they're available to vi.mock factories)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn<() => Partial<SpawnSyncReturns<Buffer>>>(() => ({
    pid: 0,
    status: 0,
    signal: null,
    output: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  })),
  checkDocker: vi.fn(async () => ({ available: true, installed: true })),
  runCommandWithTimeout: vi.fn(async () => ({ code: 1, stdout: "", stderr: "" })),
  restoreTerminalState: vi.fn(),
  userInfo: vi.fn(() => ({
    username: "testuser",
    uid: 1000,
    gid: 1000,
    homedir: "/home/testuser",
    shell: "/bin/bash",
  })),
  fetchEndpointModels: vi.fn(async () => []),
  fsMkdir: vi.fn(async () => undefined),
  fsReadFile: vi.fn(async () => "yaml-content"),
  fsWriteFile: vi.fn(async () => undefined),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawnSync: mocks.spawnSync };
});

vi.mock("../process/docker.js", () => ({
  checkDocker: mocks.checkDocker,
}));

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: mocks.runCommandWithTimeout,
}));

vi.mock("../terminal/restore.js", () => ({
  restoreTerminalState: mocks.restoreTerminalState,
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, userInfo: mocks.userInfo } };
});

vi.mock("./model-picker.js", () => ({
  fetchEndpointModels: mocks.fetchEndpointModels,
}));

vi.mock("./onboard-ollama.js", () => ({
  OLLAMA_PROVIDER_ID: "ollama",
  OLLAMA_DEFAULT_BASE_URL: "http://127.0.0.1:11434/v1",
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: mocks.fsMkdir,
    readFile: mocks.fsReadFile,
    writeFile: mocks.fsWriteFile,
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePrompter = (overrides: Partial<WizardPrompter> = {}): WizardPrompter => ({
  intro: vi.fn(async () => {}),
  outro: vi.fn(async () => {}),
  note: vi.fn(async () => {}),
  select: vi.fn(async () => "memory-cognee") as WizardPrompter["select"],
  multiselect: vi.fn(async () => []) as WizardPrompter["multiselect"],
  text: vi.fn(async () => "") as WizardPrompter["text"],
  confirm: vi.fn(async () => true),
  progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
  ...overrides,
});

const baseCfg: SpecialAgentConfig = {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setupMemory – offerDockerGroupFix path", () => {
  let setupMemory: typeof import("./onboard-memory.js").setupMemory;

  beforeEach(async () => {
    vi.resetAllMocks();

    // Default: Docker installed but permission denied on Linux
    mocks.checkDocker.mockResolvedValue({
      available: false,
      installed: true,
      reason: "Permission denied. Add your user to the docker group or run with sudo.",
    });
    mocks.userInfo.mockReturnValue({
      username: "testuser",
      uid: 1000,
      gid: 1000,
      homedir: "/home/testuser",
      shell: "/bin/bash",
    });

    // Re-import to pick up fresh mocks
    ({ setupMemory } = await import("./onboard-memory.js"));
  });

  /**
   * Helper that triggers the docker-group-fix path by selecting cognee while
   * Docker reports a "Permission denied" error on Linux.
   */
  async function runWithDockerPermissionDenied(
    prompterOverrides: Partial<WizardPrompter> = {},
    platform = "linux",
  ) {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    try {
      const prompter = makePrompter(prompterOverrides);
      const result = await setupMemory(
        baseCfg,
        "/workspace",
        { log: vi.fn(), error: vi.fn(), exit: vi.fn() as never },
        prompter,
        "quickstart",
      );
      return { result, prompter };
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  }

  it("calls restoreTerminalState, pauses stdin, then spawnSync — in that order", async () => {
    const callOrder: string[] = [];
    const stdinPauseSpy = vi.spyOn(process.stdin, "pause").mockImplementation(() => {
      callOrder.push("stdin.pause");
      return process.stdin;
    });
    mocks.restoreTerminalState.mockImplementation(() => {
      callOrder.push("restoreTerminalState");
    });
    mocks.spawnSync.mockImplementation((..._args: unknown[]) => {
      callOrder.push("spawnSync");
      return {
        pid: 1,
        status: 0,
        signal: null,
        output: [],
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      };
    });

    await runWithDockerPermissionDenied();

    expect(mocks.restoreTerminalState).toHaveBeenCalledWith("pre-docker-usermod");
    expect(stdinPauseSpy).toHaveBeenCalled();
    expect(mocks.spawnSync).toHaveBeenCalledWith("sudo", ["usermod", "-aG", "docker", "testuser"], {
      stdio: "inherit",
    });
    expect(callOrder).toEqual(["restoreTerminalState", "stdin.pause", "spawnSync"]);

    stdinPauseSpy.mockRestore();
  });

  it("shows success note when sudo usermod succeeds", async () => {
    mocks.spawnSync.mockReturnValue({
      pid: 1,
      status: 0,
      signal: null,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });

    const { prompter } = await runWithDockerPermissionDenied();

    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Added testuser to the docker group"),
      "Memory",
    );
  });

  it("shows spawn error when result.error is set", async () => {
    mocks.spawnSync.mockReturnValue({
      pid: 0,
      status: null,
      signal: null,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      error: new Error("ENOENT: sudo not found"),
    });

    const { prompter } = await runWithDockerPermissionDenied();

    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Failed to run sudo"),
      "Memory",
    );
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("ENOENT: sudo not found"),
      "Memory",
    );
  });

  it("shows generic failure note when sudo exits non-zero", async () => {
    mocks.spawnSync.mockReturnValue({
      pid: 1,
      status: 1,
      signal: null,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });

    const { prompter } = await runWithDockerPermissionDenied();

    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Failed to add user to the docker group"),
      "Memory",
    );
  });

  it("does not call spawnSync or touch terminal state when user declines", async () => {
    const stdinPauseSpy = vi.spyOn(process.stdin, "pause");

    await runWithDockerPermissionDenied({
      confirm: vi.fn(async () => false),
    });

    expect(mocks.restoreTerminalState).not.toHaveBeenCalled();
    expect(stdinPauseSpy).not.toHaveBeenCalled();
    expect(mocks.spawnSync).not.toHaveBeenCalled();

    stdinPauseSpy.mockRestore();
  });

  it("does not offer docker group fix on non-linux platforms", async () => {
    const { prompter } = await runWithDockerPermissionDenied({}, "darwin");

    // Should fall through to the generic "Cognee requires Docker" note, not the group fix
    expect(mocks.spawnSync).not.toHaveBeenCalled();
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Cognee requires a working Docker installation"),
      "Memory",
    );
  });
});

describe("setupMemory – cached dockerStatus", () => {
  let setupMemory: typeof import("./onboard-memory.js").setupMemory;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ setupMemory } = await import("./onboard-memory.js"));
  });

  it("uses cached dockerStatus and does not call checkDocker", async () => {
    const cachedDocker = { available: false, installed: false, reason: "Docker is not installed." };

    const prompter = makePrompter({
      select: vi.fn(async () => "memory-cognee") as WizardPrompter["select"],
    });

    await setupMemory(
      baseCfg,
      "/workspace",
      { log: vi.fn(), error: vi.fn(), exit: vi.fn() as never },
      prompter,
      "quickstart",
      { dockerStatus: cachedDocker },
    );

    expect(mocks.checkDocker).not.toHaveBeenCalled();
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Cognee requires a working Docker installation"),
      "Memory",
    );
  });
});

// ---------------------------------------------------------------------------
// Cognee LLM / Embedding model configuration tests
// ---------------------------------------------------------------------------

describe("setupMemory – cognee LLM/embedding config", () => {
  let setupMemory: typeof import("./onboard-memory.js").setupMemory;
  let fetchSpy: ReturnType<typeof vi.fn>;

  const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() as never };

  /** Config with an agent model already configured */
  const cfgWithAgent: SpecialAgentConfig = {
    models: {
      providers: {
        myProvider: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-agent-key",
          models: [],
        },
      },
    },
    agents: {
      defaults: {
        model: { primary: "myProvider/gpt-4o" },
      },
    },
  };

  beforeEach(async () => {
    vi.resetAllMocks();

    // Docker available, container NOT running
    mocks.checkDocker.mockResolvedValue({ available: true, installed: true });
    // First call: docker ps (not running), second call: docker compose up (success)
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    // fs mocks for startCogneeContainer
    mocks.fsMkdir.mockResolvedValue(undefined);
    mocks.fsReadFile.mockResolvedValue("yaml-content");
    mocks.fsWriteFile.mockResolvedValue(undefined);

    // fetchEndpointModels returns some models by default
    mocks.fetchEndpointModels.mockResolvedValue([
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "text-embedding-3-small", name: "Embedding Small" },
    ]);

    // Mock global fetch for health check
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    ({ setupMemory } = await import("./onboard-memory.js"));
  });

  it("reuses agent model for LLM and same endpoint for embedding", async () => {
    const selectFn = vi
      .fn()
      .mockResolvedValueOnce("memory-cognee") // memory choice
      .mockResolvedValueOnce("reuse") // LLM: reuse agent model
      .mockResolvedValueOnce("same") // embedding: same endpoint
      .mockResolvedValueOnce("text-embedding-3-small") as WizardPrompter["select"]; // embedding model

    const prompter = makePrompter({ select: selectFn });
    const result = await setupMemory(cfgWithAgent, "/workspace", runtime, prompter, "quickstart", {
      dockerStatus: { available: true, installed: true },
    });

    // Verify docker compose was called with all 8 env vars
    expect(mocks.runCommandWithTimeout).toHaveBeenCalledWith(
      expect.arrayContaining(["docker", "compose"]),
      expect.objectContaining({
        env: {
          LLM_PROVIDER: "custom",
          LLM_ENDPOINT: "https://api.example.com/v1",
          LLM_MODEL: "gpt-4o",
          LLM_API_KEY: "sk-agent-key",
          EMBEDDING_PROVIDER: "custom",
          EMBEDDING_ENDPOINT: "https://api.example.com/v1",
          EMBEDDING_MODEL: "text-embedding-3-small",
          EMBEDDING_API_KEY: "sk-agent-key",
        },
      }),
    );

    // Verify plugin config
    const pluginCfg = result.plugins?.entries?.["memory-cognee"]?.config as Record<string, unknown>;
    expect(pluginCfg).toBeDefined();
    expect(pluginCfg.llmEndpoint).toBe("https://api.example.com/v1");
    expect(pluginCfg.llmModel).toBe("gpt-4o");
    expect(pluginCfg.embeddingEndpoint).toBe("https://api.example.com/v1");
    expect(pluginCfg.embeddingModel).toBe("text-embedding-3-small");
  });

  it("configures different LLM and different embedding endpoint", async () => {
    const selectFn = vi
      .fn()
      .mockResolvedValueOnce("memory-cognee") // memory choice
      .mockResolvedValueOnce("different") // LLM: configure different
      .mockResolvedValueOnce("openai") // LLM provider type
      .mockResolvedValueOnce("gpt-4o") // LLM model from list
      .mockResolvedValueOnce("different") // embedding: different endpoint
      .mockResolvedValueOnce("openai") // embedding provider type
      .mockResolvedValueOnce("text-embedding-3-small") as WizardPrompter["select"]; // embedding model from list

    const textFn = vi
      .fn()
      .mockResolvedValueOnce("https://llm.example.com/v1") // LLM endpoint
      .mockResolvedValueOnce("sk-llm-key") // LLM API key
      .mockResolvedValueOnce("https://embed.example.com/v1") // embedding endpoint
      .mockResolvedValueOnce("sk-embed-key") as WizardPrompter["text"]; // embedding API key

    const prompter = makePrompter({ select: selectFn, text: textFn });
    const result = await setupMemory(cfgWithAgent, "/workspace", runtime, prompter, "quickstart", {
      dockerStatus: { available: true, installed: true },
    });

    expect(mocks.runCommandWithTimeout).toHaveBeenCalledWith(
      expect.arrayContaining(["docker", "compose"]),
      expect.objectContaining({
        env: {
          LLM_PROVIDER: "custom",
          LLM_ENDPOINT: "https://llm.example.com/v1",
          LLM_MODEL: "gpt-4o",
          LLM_API_KEY: "sk-llm-key",
          EMBEDDING_PROVIDER: "custom",
          EMBEDDING_ENDPOINT: "https://embed.example.com/v1",
          EMBEDDING_MODEL: "text-embedding-3-small",
          EMBEDDING_API_KEY: "sk-embed-key",
        },
      }),
    );

    const pluginCfg = result.plugins?.entries?.["memory-cognee"]?.config as Record<string, unknown>;
    expect(pluginCfg.llmEndpoint).toBe("https://llm.example.com/v1");
    expect(pluginCfg.embeddingEndpoint).toBe("https://embed.example.com/v1");
  });

  it("goes directly to endpoint prompts when no agent model is configured", async () => {
    const selectFn = vi
      .fn()
      .mockResolvedValueOnce("memory-cognee") // memory choice
      // No "reuse/different" select — goes straight to promptEndpointConfig
      .mockResolvedValueOnce("openai") // LLM provider type
      .mockResolvedValueOnce("gpt-4o") // LLM model from list
      .mockResolvedValueOnce("same") // embedding: same endpoint
      .mockResolvedValueOnce("text-embedding-3-small") as WizardPrompter["select"]; // embedding model

    const textFn = vi
      .fn()
      .mockResolvedValueOnce("https://api.openai.com/v1") // LLM endpoint
      .mockResolvedValueOnce("sk-manual-key") as WizardPrompter["text"]; // LLM API key

    const prompter = makePrompter({ select: selectFn, text: textFn });
    await setupMemory(baseCfg, "/workspace", runtime, prompter, "quickstart", {
      dockerStatus: { available: true, installed: true },
    });

    // Should NOT have a "reuse/different" prompt — the second select should be the provider type
    expect(selectFn).toHaveBeenCalledTimes(5);
    expect(mocks.runCommandWithTimeout).toHaveBeenCalledWith(
      expect.arrayContaining(["docker", "compose"]),
      expect.objectContaining({
        env: expect.objectContaining({
          LLM_ENDPOINT: "https://api.openai.com/v1",
          LLM_API_KEY: "sk-manual-key",
          LLM_MODEL: "gpt-4o",
        }),
      }),
    );
  });

  it("falls back to manual model input when fetchEndpointModels fails", async () => {
    mocks.fetchEndpointModels.mockRejectedValue(new Error("network error"));

    const selectFn = vi
      .fn()
      .mockResolvedValueOnce("memory-cognee") // memory choice
      .mockResolvedValueOnce("openai") // LLM provider type
      .mockResolvedValueOnce("same") as WizardPrompter["select"]; // embedding: same endpoint

    const textFn = vi
      .fn()
      .mockResolvedValueOnce("https://api.openai.com/v1") // LLM endpoint
      .mockResolvedValueOnce("sk-key") // LLM API key
      .mockResolvedValueOnce("gpt-4o") // LLM model (manual)
      .mockResolvedValueOnce("text-embedding-3-small") as WizardPrompter["text"]; // embedding model (manual)

    const prompter = makePrompter({ select: selectFn, text: textFn });
    await setupMemory(baseCfg, "/workspace", runtime, prompter, "quickstart", {
      dockerStatus: { available: true, installed: true },
    });

    expect(mocks.runCommandWithTimeout).toHaveBeenCalledWith(
      expect.arrayContaining(["docker", "compose"]),
      expect.objectContaining({
        env: expect.objectContaining({
          LLM_MODEL: "gpt-4o",
          EMBEDDING_MODEL: "text-embedding-3-small",
        }),
      }),
    );
  });

  it("plugin config includes model metadata but not API keys", async () => {
    const selectFn = vi
      .fn()
      .mockResolvedValueOnce("memory-cognee")
      .mockResolvedValueOnce("reuse")
      .mockResolvedValueOnce("same")
      .mockResolvedValueOnce("text-embedding-3-small") as WizardPrompter["select"];

    const prompter = makePrompter({ select: selectFn });
    const result = await setupMemory(cfgWithAgent, "/workspace", runtime, prompter, "quickstart", {
      dockerStatus: { available: true, installed: true },
    });

    const pluginCfg = result.plugins?.entries?.["memory-cognee"]?.config as Record<string, unknown>;
    expect(pluginCfg).toBeDefined();
    // Metadata present
    expect(pluginCfg.llmEndpoint).toBe("https://api.example.com/v1");
    expect(pluginCfg.llmModel).toBe("gpt-4o");
    expect(pluginCfg.embeddingEndpoint).toBe("https://api.example.com/v1");
    expect(pluginCfg.embeddingModel).toBe("text-embedding-3-small");
    // API keys NOT stored in plugin config
    expect(pluginCfg).not.toHaveProperty("llmApiKey");
    expect(pluginCfg).not.toHaveProperty("embeddingApiKey");
    expect(pluginCfg).not.toHaveProperty("LLM_API_KEY");
    expect(pluginCfg).not.toHaveProperty("EMBEDDING_API_KEY");
  });

  it("sets ollama provider when user selects Ollama endpoint type", async () => {
    const selectFn = vi
      .fn()
      .mockResolvedValueOnce("memory-cognee") // memory choice
      .mockResolvedValueOnce("different") // LLM: configure different
      .mockResolvedValueOnce("ollama") // LLM provider type: Ollama
      .mockResolvedValueOnce("llama3") // LLM model from list
      .mockResolvedValueOnce("same") // embedding: same endpoint
      .mockResolvedValueOnce("nomic-embed-text") as WizardPrompter["select"]; // embedding model

    const textFn = vi
      .fn()
      .mockResolvedValueOnce("http://127.0.0.1:11434/v1") // LLM endpoint
      .mockResolvedValueOnce("") as WizardPrompter["text"]; // LLM API key (empty, allowed for Ollama)

    const prompter = makePrompter({ select: selectFn, text: textFn });
    await setupMemory(cfgWithAgent, "/workspace", runtime, prompter, "quickstart", {
      dockerStatus: { available: true, installed: true },
    });

    expect(mocks.runCommandWithTimeout).toHaveBeenCalledWith(
      expect.arrayContaining(["docker", "compose"]),
      expect.objectContaining({
        env: {
          LLM_PROVIDER: "ollama",
          LLM_ENDPOINT: "http://127.0.0.1:11434/v1",
          LLM_MODEL: "llama3",
          LLM_API_KEY: "",
          EMBEDDING_PROVIDER: "ollama",
          EMBEDDING_ENDPOINT: "http://127.0.0.1:11434/v1",
          EMBEDDING_MODEL: "nomic-embed-text",
          EMBEDDING_API_KEY: "",
        },
      }),
    );
  });

  it("reuses agent model with ollama provider when agent uses ollama", async () => {
    const cfgWithOllama: SpecialAgentConfig = {
      models: {
        providers: {
          ollama: {
            baseUrl: "http://127.0.0.1:11434/v1",
            apiKey: "",
            models: [],
          },
        },
      },
      agents: {
        defaults: {
          model: { primary: "ollama/llama3" },
        },
      },
    };

    const selectFn = vi
      .fn()
      .mockResolvedValueOnce("memory-cognee") // memory choice
      .mockResolvedValueOnce("reuse") // LLM: reuse agent model
      .mockResolvedValueOnce("same") // embedding: same endpoint
      .mockResolvedValueOnce("nomic-embed-text") as WizardPrompter["select"]; // embedding model

    const prompter = makePrompter({ select: selectFn });
    await setupMemory(cfgWithOllama, "/workspace", runtime, prompter, "quickstart", {
      dockerStatus: { available: true, installed: true },
    });

    expect(mocks.runCommandWithTimeout).toHaveBeenCalledWith(
      expect.arrayContaining(["docker", "compose"]),
      expect.objectContaining({
        env: {
          LLM_PROVIDER: "ollama",
          LLM_ENDPOINT: "http://127.0.0.1:11434/v1",
          LLM_MODEL: "llama3",
          LLM_API_KEY: "",
          EMBEDDING_PROVIDER: "ollama",
          EMBEDDING_ENDPOINT: "http://127.0.0.1:11434/v1",
          EMBEDDING_MODEL: "nomic-embed-text",
          EMBEDDING_API_KEY: "",
        },
      }),
    );
  });
});
