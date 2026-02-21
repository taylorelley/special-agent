import { describe, expect, it } from "vitest";
import {
  normalizePluginsConfig,
  resolveEnableState,
  type NormalizedPluginsConfig,
} from "./config-state.js";

describe("normalizePluginsConfig", () => {
  it("uses default memory slot when not specified", () => {
    const result = normalizePluginsConfig({});
    expect(result.slots.memory).toBe("memory-core");
  });

  it("respects explicit memory slot value", () => {
    const result = normalizePluginsConfig({
      slots: { memory: "custom-memory" },
    });
    expect(result.slots.memory).toBe("custom-memory");
  });

  it("disables memory slot when set to 'none'", () => {
    const result = normalizePluginsConfig({
      slots: { memory: "none" },
    });
    expect(result.slots.memory).toBeNull();
  });

  it("disables memory slot when set to 'None' (case insensitive)", () => {
    const result = normalizePluginsConfig({
      slots: { memory: "None" },
    });
    expect(result.slots.memory).toBeNull();
  });

  it("trims whitespace from memory slot value", () => {
    const result = normalizePluginsConfig({
      slots: { memory: "  custom-memory  " },
    });
    expect(result.slots.memory).toBe("custom-memory");
  });

  it("uses default when memory slot is empty string", () => {
    const result = normalizePluginsConfig({
      slots: { memory: "" },
    });
    expect(result.slots.memory).toBe("memory-core");
  });

  it("uses default when memory slot is whitespace only", () => {
    const result = normalizePluginsConfig({
      slots: { memory: "   " },
    });
    expect(result.slots.memory).toBe("memory-core");
  });
});

describe("resolveEnableState", () => {
  const baseConfig: NormalizedPluginsConfig = {
    enabled: true,
    allow: [],
    deny: [],
    loadPaths: [],
    slots: {},
    entries: {},
  };

  it("auto-enables scope-commands when a memory plugin is active", () => {
    const config = { ...baseConfig, slots: { memory: "memory-cognee" } };
    const result = resolveEnableState("scope-commands", "bundled", config);
    expect(result.enabled).toBe(true);
  });

  it("does not auto-enable scope-commands when memory slot is null", () => {
    const config = { ...baseConfig, slots: { memory: null } };
    const result = resolveEnableState("scope-commands", "bundled", config);
    expect(result.enabled).toBe(false);
  });

  it("does not auto-enable scope-commands when memory slot is undefined", () => {
    const config = { ...baseConfig, slots: { memory: undefined } };
    const result = resolveEnableState("scope-commands", "bundled", config);
    expect(result.enabled).toBe(false);
  });

  it("respects explicit disable even when memory is active", () => {
    const config = {
      ...baseConfig,
      slots: { memory: "memory-cognee" },
      entries: { "scope-commands": { enabled: false } },
    };
    const result = resolveEnableState("scope-commands", "bundled", config);
    expect(result.enabled).toBe(false);
  });

  it("respects denylist even when memory is active", () => {
    const config = {
      ...baseConfig,
      slots: { memory: "memory-cognee" },
      deny: ["scope-commands"],
    };
    const result = resolveEnableState("scope-commands", "bundled", config);
    expect(result.enabled).toBe(false);
  });
});
