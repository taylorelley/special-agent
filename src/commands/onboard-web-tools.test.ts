import { describe, expect, it, vi } from "vitest";
import type { SpecialAgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { setupWebTools } from "./onboard-web-tools.js";

function makeRuntime(): RuntimeEnv {
  return { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
}

function makePrompter(overrides?: Partial<WizardPrompter>): WizardPrompter {
  return {
    intro: vi.fn(async () => {}),
    outro: vi.fn(async () => {}),
    note: vi.fn(async () => {}),
    select: vi.fn(async () => "quickstart"),
    multiselect: vi.fn(async () => []),
    text: vi.fn(async () => ""),
    confirm: vi.fn(async () => false),
    progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
    ...overrides,
  };
}

describe("setupWebTools", () => {
  it("quickstart: enables web_fetch and skips web_search when no key provided", async () => {
    const prompter = makePrompter({
      text: vi.fn(async () => ""),
    });

    const cfg: SpecialAgentConfig = {};
    const result = await setupWebTools(cfg, makeRuntime(), prompter, "quickstart");

    expect(result.tools?.web?.fetch?.enabled).toBe(true);
    expect(result.tools?.web?.search?.enabled).toBe(false);
    expect(result.tools?.web?.search?.apiKey).toBeUndefined();
  });

  it("quickstart: enables web_search when Brave API key is provided", async () => {
    const prompter = makePrompter({
      text: vi.fn(async () => "BSA-test-key-123"),
    });

    const cfg: SpecialAgentConfig = {};
    const result = await setupWebTools(cfg, makeRuntime(), prompter, "quickstart");

    expect(result.tools?.web?.fetch?.enabled).toBe(true);
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(result.tools?.web?.search?.apiKey).toBe("BSA-test-key-123");
  });

  it("advanced: prompts for search enable, key, and fetch enable", async () => {
    const textMock = vi.fn(async () => "BSA-advanced-key");
    const confirmMock = vi.fn(async (opts) => {
      if (typeof opts.message === "string" && opts.message.includes("web_search")) {
        return true;
      }
      if (typeof opts.message === "string" && opts.message.includes("web_fetch")) {
        return true;
      }
      return false;
    });

    const prompter = makePrompter({
      text: textMock,
      confirm: confirmMock,
    });

    const cfg: SpecialAgentConfig = {};
    const result = await setupWebTools(cfg, makeRuntime(), prompter, "advanced");

    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(result.tools?.web?.search?.apiKey).toBe("BSA-advanced-key");
    expect(result.tools?.web?.fetch?.enabled).toBe(true);
  });

  it("advanced: disables search when user declines", async () => {
    const confirmMock = vi.fn(async (opts) => {
      if (typeof opts.message === "string" && opts.message.includes("web_search")) {
        return false;
      }
      if (typeof opts.message === "string" && opts.message.includes("web_fetch")) {
        return true;
      }
      return false;
    });

    const prompter = makePrompter({
      confirm: confirmMock,
    });

    const cfg: SpecialAgentConfig = {};
    const result = await setupWebTools(cfg, makeRuntime(), prompter, "advanced");

    expect(result.tools?.web?.search?.enabled).toBe(false);
    expect(result.tools?.web?.fetch?.enabled).toBe(true);
  });

  it("preserves existing config values", async () => {
    const prompter = makePrompter({
      text: vi.fn(async () => ""),
    });

    const cfg: SpecialAgentConfig = {
      tools: {
        web: {
          search: { maxResults: 5 },
          fetch: { maxChars: 10000 },
        },
      },
    };
    const result = await setupWebTools(cfg, makeRuntime(), prompter, "quickstart");

    expect(result.tools?.web?.search?.maxResults).toBe(5);
    expect(result.tools?.web?.fetch?.maxChars).toBe(10000);
  });
});
