import type { Api, Model } from "@mariozechner/pi-ai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const oauthFixture = {
  access: "access-token",
  refresh: "refresh-token",
  expires: Date.now() + 60_000,
  accountId: "acct_123",
};

describe("getApiKeyForModel", () => {
  it("migrates legacy oauth.json into auth-profiles.json", async () => {
    const previousStateDir = process.env.SPECIAL_AGENT_STATE_DIR;
    const previousAgentDir = process.env.SPECIAL_AGENT_AGENT_DIR;
    const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "special-agent-oauth-"));

    try {
      process.env.SPECIAL_AGENT_STATE_DIR = tempDir;
      process.env.SPECIAL_AGENT_AGENT_DIR = path.join(tempDir, "agent");
      process.env.PI_CODING_AGENT_DIR = process.env.SPECIAL_AGENT_AGENT_DIR;

      const oauthDir = path.join(tempDir, "credentials");
      await fs.mkdir(oauthDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(
        path.join(oauthDir, "oauth.json"),
        `${JSON.stringify({ "openai-codex": oauthFixture }, null, 2)}\n`,
        "utf8",
      );

      vi.resetModules();
      const { ensureAuthProfileStore } = await import("./auth-profiles.js");
      const { getApiKeyForModel } = await import("./model-auth.js");

      const model = {
        id: "codex-mini-latest",
        provider: "openai-codex",
        api: "openai-codex-responses",
      } as Model<Api>;

      const store = ensureAuthProfileStore(process.env.SPECIAL_AGENT_AGENT_DIR, {
        allowKeychainPrompt: false,
      });
      const apiKey = await getApiKeyForModel({
        model,
        cfg: {
          auth: {
            profiles: {
              "openai-codex:default": {
                provider: "openai-codex",
                mode: "oauth",
              },
            },
          },
        },
        store,
        agentDir: process.env.SPECIAL_AGENT_AGENT_DIR,
      });
      expect(apiKey.apiKey).toBe(oauthFixture.access);

      const authProfiles = await fs.readFile(
        path.join(tempDir, "agent", "auth-profiles.json"),
        "utf8",
      );
      const authData = JSON.parse(authProfiles) as Record<string, unknown>;
      expect(authData.profiles).toMatchObject({
        "openai-codex:default": {
          type: "oauth",
          provider: "openai-codex",
          access: oauthFixture.access,
          refresh: oauthFixture.refresh,
        },
      });
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.SPECIAL_AGENT_STATE_DIR;
      } else {
        process.env.SPECIAL_AGENT_STATE_DIR = previousStateDir;
      }
      if (previousAgentDir === undefined) {
        delete process.env.SPECIAL_AGENT_AGENT_DIR;
      } else {
        process.env.SPECIAL_AGENT_AGENT_DIR = previousAgentDir;
      }
      if (previousPiAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when ZAI API key is missing", async () => {
    const previousZai = process.env.ZAI_API_KEY;

    try {
      delete process.env.ZAI_API_KEY;

      vi.resetModules();
      const { resolveApiKeyForProvider } = await import("./model-auth.js");

      let error: unknown = null;
      try {
        await resolveApiKeyForProvider({
          provider: "zai",
          store: { version: 1, profiles: {} },
        });
      } catch (err) {
        error = err;
      }

      expect(String(error)).toContain('No API key found for provider "zai".');
    } finally {
      if (previousZai === undefined) {
        delete process.env.ZAI_API_KEY;
      } else {
        process.env.ZAI_API_KEY = previousZai;
      }
    }
  });

  it("resolves Qianfan API key from env", async () => {
    const previous = process.env.QIANFAN_API_KEY;

    try {
      process.env.QIANFAN_API_KEY = "qianfan-test-key";

      vi.resetModules();
      const { resolveApiKeyForProvider } = await import("./model-auth.js");

      const resolved = await resolveApiKeyForProvider({
        provider: "qianfan",
        store: { version: 1, profiles: {} },
      });
      expect(resolved.apiKey).toBe("qianfan-test-key");
      expect(resolved.source).toContain("QIANFAN_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.QIANFAN_API_KEY;
      } else {
        process.env.QIANFAN_API_KEY = previous;
      }
    }
  });

  it("accepts VOYAGE_API_KEY for voyage", async () => {
    const previous = process.env.VOYAGE_API_KEY;

    try {
      process.env.VOYAGE_API_KEY = "voyage-test-key";

      vi.resetModules();
      const { resolveApiKeyForProvider } = await import("./model-auth.js");

      const resolved = await resolveApiKeyForProvider({
        provider: "voyage",
        store: { version: 1, profiles: {} },
      });
      expect(resolved.apiKey).toBe("voyage-test-key");
      expect(resolved.source).toContain("VOYAGE_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.VOYAGE_API_KEY;
      } else {
        process.env.VOYAGE_API_KEY = previous;
      }
    }
  });

  it("strips embedded CR/LF from ANTHROPIC_API_KEY", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;

    try {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-\r\nkey";

      vi.resetModules();
      const { resolveEnvApiKey } = await import("./model-auth.js");

      const resolved = resolveEnvApiKey("anthropic");
      expect(resolved?.apiKey).toBe("sk-ant-test-key");
      expect(resolved?.source).toContain("ANTHROPIC_API_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previous;
      }
    }
  });
});
