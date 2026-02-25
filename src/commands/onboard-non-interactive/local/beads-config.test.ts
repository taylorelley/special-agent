import { describe, expect, it, vi } from "vitest";
import type { SpecialAgentConfig } from "../../../config/config.js";
import type { RuntimeEnv } from "../../../runtime.js";
import { applyNonInteractiveBeadsConfig } from "./beads-config.js";

const applyBeadsConfig = vi.hoisted(() => vi.fn((cfg, params) => ({ ...cfg, _beads: params })));

vi.mock("../../onboard-beads.js", () => ({
  applyBeadsConfig,
}));

function makeRuntime(): RuntimeEnv {
  return { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
}

describe("applyNonInteractiveBeadsConfig", () => {
  it("returns unchanged config when skipBeads is true", () => {
    const cfg: SpecialAgentConfig = {};
    const result = applyNonInteractiveBeadsConfig({
      nextConfig: cfg,
      opts: { skipBeads: true },
      runtime: makeRuntime(),
    });
    expect(result).toBe(cfg);
    expect(applyBeadsConfig).not.toHaveBeenCalled();
  });

  it("applies beads disabled when skipBeads is false", () => {
    applyBeadsConfig.mockClear();
    const cfg: SpecialAgentConfig = {};
    const result = applyNonInteractiveBeadsConfig({
      nextConfig: cfg,
      opts: {},
      runtime: makeRuntime(),
    });
    expect(applyBeadsConfig).toHaveBeenCalledWith(cfg, { enabled: false });
    expect(result).toEqual({ _beads: { enabled: false } });
  });
});
