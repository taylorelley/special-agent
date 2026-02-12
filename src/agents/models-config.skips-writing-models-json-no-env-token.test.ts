import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpecialAgentConfig } from "../config/config.js";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  return withTempHomeBase(fn, { prefix: "special-agent-models-" });
}

const MODELS_CONFIG: SpecialAgentConfig = {
  models: {
    providers: {
      "custom-proxy": {
        baseUrl: "http://localhost:4000/v1",
        apiKey: "TEST_KEY",
        api: "openai-completions",
        models: [
          {
            id: "llama-3.1-8b",
            name: "Llama 3.1 8B (Proxy)",
            api: "openai-completions",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 32000,
          },
        ],
      },
    },
  },
};

describe("models-config", () => {
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = previousHome;
  });

  it("skips writing models.json when no env token or profile exists", async () => {
    await withTempHome(async (home) => {
      try {
        vi.resetModules();
        const { ensureSpecialAgentModelsJson } = await import("./models-config.js");

        const agentDir = path.join(home, "agent-empty");
        const result = await ensureSpecialAgentModelsJson(
          {
            models: { providers: {} },
          },
          agentDir,
        );

        await expect(fs.stat(path.join(agentDir, "models.json"))).rejects.toThrow();
        expect(result.wrote).toBe(false);
      } finally {
        // no env cleanup needed
      }
    });
  });
  it("writes models.json for configured providers", async () => {
    await withTempHome(async () => {
      vi.resetModules();
      const { ensureSpecialAgentModelsJson } = await import("./models-config.js");
      const { resolveSpecialAgentAgentDir } = await import("./agent-paths.js");

      await ensureSpecialAgentModelsJson(MODELS_CONFIG);

      const modelPath = path.join(resolveSpecialAgentAgentDir(), "models.json");
      const raw = await fs.readFile(modelPath, "utf8");
      const parsed = JSON.parse(raw) as {
        providers: Record<string, { baseUrl?: string }>;
      };

      expect(parsed.providers["custom-proxy"]?.baseUrl).toBe("http://localhost:4000/v1");
    });
  });
  // Implicit provider auto-discovery (minimax, synthetic, etc.) has been removed.
  // Only explicitly configured providers are written to models.json.
});
