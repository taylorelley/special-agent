import { afterEach, describe, expect, it } from "vitest";
import {
  getScopeOverride,
  setScopeOverride,
  clearScopeOverride,
  clearAllScopeOverrides,
  getScopeOverrideCount,
} from "./session-state.js";

describe("scope session state", () => {
  afterEach(() => {
    clearAllScopeOverrides();
  });

  it("returns undefined when no override is set", () => {
    expect(getScopeOverride("session-1")).toBeUndefined();
  });

  it("stores and retrieves a personal override", () => {
    setScopeOverride("session-1", { tier: "personal" });
    expect(getScopeOverride("session-1")).toEqual({ tier: "personal" });
  });

  it("stores and retrieves a project override", () => {
    setScopeOverride("session-1", { tier: "project", projectId: "webapp" });
    expect(getScopeOverride("session-1")).toEqual({ tier: "project", projectId: "webapp" });
  });

  it("stores and retrieves a team override", () => {
    setScopeOverride("session-1", { tier: "team" });
    expect(getScopeOverride("session-1")).toEqual({ tier: "team" });
  });

  it("replaces existing override", () => {
    setScopeOverride("session-1", { tier: "personal" });
    setScopeOverride("session-1", { tier: "team" });
    expect(getScopeOverride("session-1")).toEqual({ tier: "team" });
  });

  it("does not affect other sessions", () => {
    setScopeOverride("session-1", { tier: "team" });
    setScopeOverride("session-2", { tier: "project", projectId: "infra" });
    expect(getScopeOverride("session-1")).toEqual({ tier: "team" });
    expect(getScopeOverride("session-2")).toEqual({ tier: "project", projectId: "infra" });
  });

  it("clears a specific session override", () => {
    setScopeOverride("session-1", { tier: "team" });
    setScopeOverride("session-2", { tier: "personal" });
    clearScopeOverride("session-1");
    expect(getScopeOverride("session-1")).toBeUndefined();
    expect(getScopeOverride("session-2")).toEqual({ tier: "personal" });
  });

  it("clears all overrides", () => {
    setScopeOverride("session-1", { tier: "team" });
    setScopeOverride("session-2", { tier: "personal" });
    clearAllScopeOverrides();
    expect(getScopeOverride("session-1")).toBeUndefined();
    expect(getScopeOverride("session-2")).toBeUndefined();
  });

  it("tracks override count", () => {
    expect(getScopeOverrideCount()).toBe(0);
    setScopeOverride("session-1", { tier: "team" });
    expect(getScopeOverrideCount()).toBe(1);
    setScopeOverride("session-2", { tier: "personal" });
    expect(getScopeOverrideCount()).toBe(2);
    clearScopeOverride("session-1");
    expect(getScopeOverrideCount()).toBe(1);
    clearAllScopeOverrides();
    expect(getScopeOverrideCount()).toBe(0);
  });
});
