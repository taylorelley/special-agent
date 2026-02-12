import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { AuthChoice } from "./onboard-types.js";
import { applyAuthChoice, resolvePreferredProviderForAuthChoice } from "./auth-choice.js";

const resolvePluginProviders = vi.hoisted(() => vi.fn(() => []));
vi.mock("../plugins/providers.js", () => ({
  resolvePluginProviders,
}));

const noopAsync = async () => {};
const noop = () => {};
const authProfilePathFor = (agentDir: string) => path.join(agentDir, "auth-profiles.json");
const requireAgentDir = () => {
  const agentDir = process.env.SPECIAL_AGENT_AGENT_DIR;
  if (!agentDir) {
    throw new Error("SPECIAL_AGENT_AGENT_DIR not set");
  }
  return agentDir;
};

describe("applyAuthChoice", () => {
  const previousStateDir = process.env.SPECIAL_AGENT_STATE_DIR;
  const previousAgentDir = process.env.SPECIAL_AGENT_AGENT_DIR;
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOpenrouterKey = process.env.OPENROUTER_API_KEY;
  const previousLitellmKey = process.env.LITELLM_API_KEY;
  const previousAiGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const previousCloudflareGatewayKey = process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;
  const previousSshTty = process.env.SSH_TTY;
  const previousChutesClientId = process.env.CHUTES_CLIENT_ID;
  let tempStateDir: string | null = null;

  afterEach(async () => {
    vi.unstubAllGlobals();
    resolvePluginProviders.mockReset();
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
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
    if (previousOpenrouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousOpenrouterKey;
    }
    if (previousLitellmKey === undefined) {
      delete process.env.LITELLM_API_KEY;
    } else {
      process.env.LITELLM_API_KEY = previousLitellmKey;
    }
    if (previousAiGatewayKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = previousAiGatewayKey;
    }
    if (previousCloudflareGatewayKey === undefined) {
      delete process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;
    } else {
      process.env.CLOUDFLARE_AI_GATEWAY_API_KEY = previousCloudflareGatewayKey;
    }
    if (previousSshTty === undefined) {
      delete process.env.SSH_TTY;
    } else {
      process.env.SSH_TTY = previousSshTty;
    }
    if (previousChutesClientId === undefined) {
      delete process.env.CHUTES_CLIENT_ID;
    } else {
      process.env.CHUTES_CLIENT_ID = previousChutesClientId;
    }
  });

  // minimax-api test removed (handler in auth-choice.apply.minimax.ts was stripped).
  // Synthetic API key test removed (provider stripped).
  // xai-api-key test removed (handler in auth-choice.apply.xai.ts was stripped).
  // github-copilot test removed (provider stripped).
  // opencode-zen test removed (provider stripped).

  it("uses existing OPENROUTER_API_KEY when selecting openrouter-api-key", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "special-agent-auth-"));
    process.env.SPECIAL_AGENT_STATE_DIR = tempStateDir;
    process.env.SPECIAL_AGENT_AGENT_DIR = path.join(tempStateDir, "agent");
    process.env.PI_CODING_AGENT_DIR = process.env.SPECIAL_AGENT_AGENT_DIR;
    process.env.OPENROUTER_API_KEY = "sk-openrouter-test";

    const text = vi.fn();
    const select: WizardPrompter["select"] = vi.fn(
      async (params) => params.options[0]?.value as never,
    );
    const multiselect: WizardPrompter["multiselect"] = vi.fn(async () => []);
    const confirm = vi.fn(async () => true);
    const prompter: WizardPrompter = {
      intro: vi.fn(noopAsync),
      outro: vi.fn(noopAsync),
      note: vi.fn(noopAsync),
      select,
      multiselect,
      text,
      confirm,
      progress: vi.fn(() => ({ update: noop, stop: noop })),
    };
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };

    const result = await applyAuthChoice({
      authChoice: "openrouter-api-key",
      config: {},
      prompter,
      runtime,
      setDefaultModel: true,
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("OPENROUTER_API_KEY"),
      }),
    );
    expect(text).not.toHaveBeenCalled();
    expect(result.config.auth?.profiles?.["openrouter:default"]).toMatchObject({
      provider: "openrouter",
      mode: "api_key",
    });
    expect(result.config.agents?.defaults?.model?.primary).toBe("openrouter/auto");

    const authProfilePath = authProfilePathFor(requireAgentDir());
    const raw = await fs.readFile(authProfilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<string, { key?: string }>;
    };
    expect(parsed.profiles?.["openrouter:default"]?.key).toBe("sk-openrouter-test");

    delete process.env.OPENROUTER_API_KEY;
  });

  it("ignores legacy LiteLLM oauth profiles when selecting litellm-api-key", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "special-agent-auth-"));
    process.env.SPECIAL_AGENT_STATE_DIR = tempStateDir;
    process.env.SPECIAL_AGENT_AGENT_DIR = path.join(tempStateDir, "agent");
    process.env.PI_CODING_AGENT_DIR = process.env.SPECIAL_AGENT_AGENT_DIR;
    process.env.LITELLM_API_KEY = "sk-litellm-test";

    const authProfilePath = authProfilePathFor(requireAgentDir());
    await fs.mkdir(path.dirname(authProfilePath), { recursive: true });
    await fs.writeFile(
      authProfilePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "litellm:legacy": {
              type: "oauth",
              provider: "litellm",
              access: "access-token",
              refresh: "refresh-token",
              expires: Date.now() + 60_000,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const text = vi.fn();
    const select: WizardPrompter["select"] = vi.fn(
      async (params) => params.options[0]?.value as never,
    );
    const multiselect: WizardPrompter["multiselect"] = vi.fn(async () => []);
    const confirm = vi.fn(async () => true);
    const prompter: WizardPrompter = {
      intro: vi.fn(noopAsync),
      outro: vi.fn(noopAsync),
      note: vi.fn(noopAsync),
      select,
      multiselect,
      text,
      confirm,
      progress: vi.fn(() => ({ update: noop, stop: noop })),
    };
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };

    const result = await applyAuthChoice({
      authChoice: "litellm-api-key",
      config: {
        auth: {
          profiles: {
            "litellm:legacy": { provider: "litellm", mode: "oauth" },
          },
          order: { litellm: ["litellm:legacy"] },
        },
      },
      prompter,
      runtime,
      setDefaultModel: true,
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("LITELLM_API_KEY"),
      }),
    );
    expect(text).not.toHaveBeenCalled();
    expect(result.config.auth?.profiles?.["litellm:default"]).toMatchObject({
      provider: "litellm",
      mode: "api_key",
    });

    const raw = await fs.readFile(authProfilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<string, { type?: string; key?: string }>;
    };
    expect(parsed.profiles?.["litellm:default"]).toMatchObject({
      type: "api_key",
      key: "sk-litellm-test",
    });
  });

  it("uses existing AI_GATEWAY_API_KEY when selecting ai-gateway-api-key", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "special-agent-auth-"));
    process.env.SPECIAL_AGENT_STATE_DIR = tempStateDir;
    process.env.SPECIAL_AGENT_AGENT_DIR = path.join(tempStateDir, "agent");
    process.env.PI_CODING_AGENT_DIR = process.env.SPECIAL_AGENT_AGENT_DIR;
    process.env.AI_GATEWAY_API_KEY = "gateway-test-key";

    const text = vi.fn();
    const select: WizardPrompter["select"] = vi.fn(
      async (params) => params.options[0]?.value as never,
    );
    const multiselect: WizardPrompter["multiselect"] = vi.fn(async () => []);
    const confirm = vi.fn(async () => true);
    const prompter: WizardPrompter = {
      intro: vi.fn(noopAsync),
      outro: vi.fn(noopAsync),
      note: vi.fn(noopAsync),
      select,
      multiselect,
      text,
      confirm,
      progress: vi.fn(() => ({ update: noop, stop: noop })),
    };
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };

    const result = await applyAuthChoice({
      authChoice: "ai-gateway-api-key",
      config: {},
      prompter,
      runtime,
      setDefaultModel: true,
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("AI_GATEWAY_API_KEY"),
      }),
    );
    expect(text).not.toHaveBeenCalled();
    expect(result.config.auth?.profiles?.["vercel-ai-gateway:default"]).toMatchObject({
      provider: "vercel-ai-gateway",
      mode: "api_key",
    });
    expect(result.config.agents?.defaults?.model?.primary).toBe(
      "vercel-ai-gateway/anthropic/claude-opus-4.6",
    );

    const authProfilePath = authProfilePathFor(requireAgentDir());
    const raw = await fs.readFile(authProfilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<string, { key?: string }>;
    };
    expect(parsed.profiles?.["vercel-ai-gateway:default"]?.key).toBe("gateway-test-key");

    delete process.env.AI_GATEWAY_API_KEY;
  });

  // cloudflare-ai-gateway-api-key test removed (handler in auth-choice.apply.copilot-proxy.ts was stripped).

  it("writes Chutes OAuth credentials when selecting chutes (remote/manual)", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "special-agent-auth-"));
    process.env.SPECIAL_AGENT_STATE_DIR = tempStateDir;
    process.env.SPECIAL_AGENT_AGENT_DIR = path.join(tempStateDir, "agent");
    process.env.PI_CODING_AGENT_DIR = process.env.SPECIAL_AGENT_AGENT_DIR;
    process.env.SSH_TTY = "1";
    process.env.CHUTES_CLIENT_ID = "cid_test";

    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.chutes.ai/idp/token") {
        return new Response(
          JSON.stringify({
            access_token: "at_test",
            refresh_token: "rt_test",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "https://api.chutes.ai/idp/userinfo") {
        return new Response(JSON.stringify({ username: "remote-user" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const text = vi.fn().mockResolvedValue("code_manual");
    const select: WizardPrompter["select"] = vi.fn(
      async (params) => params.options[0]?.value as never,
    );
    const multiselect: WizardPrompter["multiselect"] = vi.fn(async () => []);
    const prompter: WizardPrompter = {
      intro: vi.fn(noopAsync),
      outro: vi.fn(noopAsync),
      note: vi.fn(noopAsync),
      select,
      multiselect,
      text,
      confirm: vi.fn(async () => false),
      progress: vi.fn(() => ({ update: noop, stop: noop })),
    };
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };

    const result = await applyAuthChoice({
      authChoice: "chutes",
      config: {},
      prompter,
      runtime,
      setDefaultModel: false,
    });

    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Paste the redirect URL (or authorization code)",
      }),
    );
    expect(result.config.auth?.profiles?.["chutes:remote-user"]).toMatchObject({
      provider: "chutes",
      mode: "oauth",
    });

    const authProfilePath = authProfilePathFor(requireAgentDir());
    const raw = await fs.readFile(authProfilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<
        string,
        { provider?: string; access?: string; refresh?: string; email?: string }
      >;
    };
    expect(parsed.profiles?.["chutes:remote-user"]).toMatchObject({
      provider: "chutes",
      access: "at_test",
      refresh: "rt_test",
      email: "remote-user",
    });
  });

  // qwen-portal test removed (handler in auth-choice.apply.qwen-portal.ts was stripped).
  // minimax-portal test removed (provider stripped).
});

describe("resolvePreferredProviderForAuthChoice", () => {
  it("maps github-copilot to the provider", () => {
    expect(resolvePreferredProviderForAuthChoice("github-copilot")).toBe("github-copilot");
  });

  it("maps qwen-portal to the provider", () => {
    expect(resolvePreferredProviderForAuthChoice("qwen-portal")).toBe("qwen-portal");
  });

  it("returns undefined for unknown choices", () => {
    expect(resolvePreferredProviderForAuthChoice("unknown" as AuthChoice)).toBeUndefined();
  });
});
