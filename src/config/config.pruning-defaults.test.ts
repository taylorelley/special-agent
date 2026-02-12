import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempHome } from "./test-helpers.js";

describe("config pruning defaults", () => {
  it("does not enable contextPruning by default", async () => {
    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    const prevOauthToken = process.env.ANTHROPIC_OAUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = "";
    process.env.ANTHROPIC_OAUTH_TOKEN = "";
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".special-agent");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "special-agent.json"),
        JSON.stringify({ agents: { defaults: {} } }, null, 2),
        "utf-8",
      );

      vi.resetModules();
      const { loadConfig } = await import("./config.js");
      const cfg = loadConfig();

      expect(cfg.agents?.defaults?.contextPruning?.mode).toBeUndefined();
    });
    if (prevApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = prevApiKey;
    }
    if (prevOauthToken === undefined) {
      delete process.env.ANTHROPIC_OAUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_OAUTH_TOKEN = prevOauthToken;
    }
  });

  it("does not auto-enable pruning for Anthropic OAuth (applyContextPruningDefaults removed)", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".special-agent");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "special-agent.json"),
        JSON.stringify(
          {
            auth: {
              profiles: {
                "anthropic:me": { provider: "anthropic", mode: "oauth", email: "me@example.com" },
              },
            },
            agents: { defaults: {} },
          },
          null,
          2,
        ),
        "utf-8",
      );

      vi.resetModules();
      const { loadConfig } = await import("./config.js");
      const cfg = loadConfig();

      expect(cfg.agents?.defaults?.contextPruning?.mode).toBeUndefined();
      expect(cfg.agents?.defaults?.heartbeat?.every).toBeUndefined();
    });
  });

  it("does not auto-enable pruning for Anthropic API keys (applyContextPruningDefaults removed)", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".special-agent");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "special-agent.json"),
        JSON.stringify(
          {
            auth: {
              profiles: {
                "anthropic:api": { provider: "anthropic", mode: "api_key" },
              },
            },
            agents: {
              defaults: {
                model: { primary: "anthropic/claude-opus-4-5" },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      vi.resetModules();
      const { loadConfig } = await import("./config.js");
      const cfg = loadConfig();

      expect(cfg.agents?.defaults?.contextPruning?.mode).toBeUndefined();
      expect(cfg.agents?.defaults?.heartbeat?.every).toBeUndefined();
    });
  });

  it("does not override explicit contextPruning mode", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".special-agent");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "special-agent.json"),
        JSON.stringify({ agents: { defaults: { contextPruning: { mode: "off" } } } }, null, 2),
        "utf-8",
      );

      vi.resetModules();
      const { loadConfig } = await import("./config.js");
      const cfg = loadConfig();

      expect(cfg.agents?.defaults?.contextPruning?.mode).toBe("off");
    });
  });
});
