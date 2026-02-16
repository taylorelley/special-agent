import { describe, expect, it, vi } from "vitest";

const loadConfig = vi.fn();
const ensureSpecialAgentModelsJson = vi.fn().mockResolvedValue(undefined);
const resolveSpecialAgentAgentDir = vi.fn().mockReturnValue("/tmp/special-agent-agent");
const ensureAuthProfileStore = vi.fn().mockReturnValue({ version: 1, profiles: {} });
const listProfilesForProvider = vi.fn().mockReturnValue([]);
const resolveAuthProfileDisplayLabel = vi.fn(({ profileId }: { profileId: string }) => profileId);
const resolveAuthStorePathForDisplay = vi
  .fn()
  .mockReturnValue("/tmp/special-agent-agent/auth-profiles.json");
const resolveProfileUnusableUntilForDisplay = vi.fn().mockReturnValue(null);
const resolveEnvApiKey = vi.fn().mockReturnValue(undefined);
const getCustomProviderApiKey = vi.fn().mockReturnValue(undefined);
const modelRegistryState = {
  models: [] as Array<Record<string, unknown>>,
  available: [] as Array<Record<string, unknown>>,
};

vi.mock("../config/config.js", () => ({
  CONFIG_PATH: "/tmp/special-agent.json",
  STATE_DIR: "/tmp/special-agent-state",
  loadConfig,
}));

vi.mock("../agents/models-config.js", () => ({
  ensureSpecialAgentModelsJson,
}));

vi.mock("../agents/agent-paths.js", () => ({
  resolveSpecialAgentAgentDir,
}));

vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore,
  listProfilesForProvider,
  resolveAuthProfileDisplayLabel,
  resolveAuthStorePathForDisplay,
  resolveProfileUnusableUntilForDisplay,
}));

vi.mock("../agents/model-auth.js", () => ({
  resolveEnvApiKey,
  getCustomProviderApiKey,
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: class {},
  ModelRegistry: class {
    getAll() {
      return modelRegistryState.models;
    }
    getAvailable() {
      return modelRegistryState.available;
    }
  },
}));

function makeRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}

describe("models list/status", () => {
  it("models list marks auth as unavailable when ZAI key is missing", async () => {
    loadConfig.mockReturnValue({
      agents: { defaults: { model: "z.ai/glm-4.7" } },
    });
    const runtime = makeRuntime();

    const model = {
      provider: "zai",
      id: "glm-4.7",
      name: "GLM-4.7",
      input: ["text"],
      baseUrl: "https://api.z.ai/v1",
      contextWindow: 128000,
    };

    modelRegistryState.models = [model];
    modelRegistryState.available = [];

    const { modelsListCommand } = await import("./models/list.js");
    await modelsListCommand({ all: true, json: true }, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0]));
    expect(payload.models[0]?.available).toBe(false);
  });
});
