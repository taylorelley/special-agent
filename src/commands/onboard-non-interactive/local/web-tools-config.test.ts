import { describe, expect, it, vi } from "vitest";
import type { SpecialAgentConfig } from "../../../config/config.js";
import type { RuntimeEnv } from "../../../runtime.js";
import { applyNonInteractiveWebToolsConfig } from "./web-tools-config.js";

function makeRuntime(): RuntimeEnv {
  return { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
}

describe("applyNonInteractiveWebToolsConfig", () => {
  it("returns unchanged config when skipWebTools is true", () => {
    const cfg: SpecialAgentConfig = {};
    const result = applyNonInteractiveWebToolsConfig({
      nextConfig: cfg,
      opts: { skipWebTools: true },
      runtime: makeRuntime(),
    });
    expect(result).toBe(cfg);
  });

  it("enables web_fetch by default", () => {
    const cfg: SpecialAgentConfig = {};
    const result = applyNonInteractiveWebToolsConfig({
      nextConfig: cfg,
      opts: {},
      runtime: makeRuntime(),
    });
    expect(result.tools?.web?.fetch?.enabled).toBe(true);
  });

  it("enables web_search when braveApiKey is provided", () => {
    const cfg: SpecialAgentConfig = {};
    const result = applyNonInteractiveWebToolsConfig({
      nextConfig: cfg,
      opts: { braveApiKey: "BSA-test-123" },
      runtime: makeRuntime(),
    });
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(result.tools?.web?.search?.apiKey).toBe("BSA-test-123");
    expect(result.tools?.web?.fetch?.enabled).toBe(true);
  });

  it("does not set search when no braveApiKey and no existing search config", () => {
    const cfg: SpecialAgentConfig = {};
    const result = applyNonInteractiveWebToolsConfig({
      nextConfig: cfg,
      opts: {},
      runtime: makeRuntime(),
    });
    expect(result.tools?.web?.search).toBeUndefined();
  });

  it("preserves existing search config when no braveApiKey", () => {
    const cfg: SpecialAgentConfig = {
      tools: {
        web: {
          search: { enabled: true, apiKey: "existing-key" },
        },
      },
    };
    const result = applyNonInteractiveWebToolsConfig({
      nextConfig: cfg,
      opts: {},
      runtime: makeRuntime(),
    });
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(result.tools?.web?.search?.apiKey).toBe("existing-key");
  });

  it("preserves existing fetch config while enabling it", () => {
    const cfg: SpecialAgentConfig = {
      tools: {
        web: {
          fetch: { maxChars: 5000 },
        },
      },
    };
    const result = applyNonInteractiveWebToolsConfig({
      nextConfig: cfg,
      opts: {},
      runtime: makeRuntime(),
    });
    expect(result.tools?.web?.fetch?.enabled).toBe(true);
    expect(result.tools?.web?.fetch?.maxChars).toBe(5000);
  });
});
