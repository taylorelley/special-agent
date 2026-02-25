import { describe, expect, it, vi } from "vitest";
import type { SpecialAgentConfig } from "../../../config/config.js";
import type { RuntimeEnv } from "../../../runtime.js";
import { applyNonInteractiveMemoryConfig } from "./memory-config.js";

const applyMemorySlot = vi.hoisted(() => vi.fn((cfg, slotId) => ({ ...cfg, _slot: slotId })));

vi.mock("../../onboard-memory.js", () => ({
  applyMemorySlot,
}));

function makeRuntime(): RuntimeEnv {
  return { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
}

describe("applyNonInteractiveMemoryConfig", () => {
  it("returns unchanged config when skipMemory is true", () => {
    const cfg: SpecialAgentConfig = {};
    const result = applyNonInteractiveMemoryConfig({
      nextConfig: cfg,
      opts: { skipMemory: true },
      runtime: makeRuntime(),
    });
    expect(result).toBe(cfg);
    expect(applyMemorySlot).not.toHaveBeenCalled();
  });

  it("applies memory-core slot when skipMemory is false", () => {
    applyMemorySlot.mockClear();
    const cfg: SpecialAgentConfig = {};
    const result = applyNonInteractiveMemoryConfig({
      nextConfig: cfg,
      opts: {},
      runtime: makeRuntime(),
    });
    expect(applyMemorySlot).toHaveBeenCalledWith(cfg, "memory-core");
    expect(result).toEqual({ _slot: "memory-core" });
  });
});
