import { afterEach, describe, expect, it } from "vitest";
import type { ScopeConfig } from "./types.js";
import {
  resolveScopeContext,
  findProjectByName,
  listProjectNames,
  isGroupSession,
} from "./resolver.js";
import { clearAllScopeOverrides, setScopeOverride } from "./session-state.js";

const TEST_CONFIG: ScopeConfig = {
  defaultTier: "personal",
  projects: [
    { id: "webapp", name: "Web Application" },
    { id: "infra", name: "Infrastructure", members: ["alice", "bob"] },
  ],
  team: { name: "Engineering", governance: true },
};

describe("isGroupSession", () => {
  it("returns false for direct chat type", () => {
    expect(isGroupSession("direct", "telegram:direct:123")).toBe(false);
  });

  it("returns true for group chat type", () => {
    expect(isGroupSession("group", "telegram:group:456")).toBe(true);
  });

  it("returns true for channel chat type", () => {
    expect(isGroupSession("channel", "slack:channel:general")).toBe(true);
  });

  it("detects group from session key when chatType is undefined", () => {
    expect(isGroupSession(undefined, "telegram:group:456")).toBe(true);
  });

  it("detects channel from session key when chatType is undefined", () => {
    expect(isGroupSession(undefined, "slack:channel:general")).toBe(true);
  });

  it("returns false when neither chatType nor key indicate group", () => {
    expect(isGroupSession(undefined, "telegram:direct:123")).toBe(false);
  });

  it("returns false for undefined inputs", () => {
    expect(isGroupSession(undefined, undefined)).toBe(false);
  });
});

describe("resolveScopeContext", () => {
  afterEach(() => {
    clearAllScopeOverrides();
  });

  it("returns personal scope by default", () => {
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:alice",
      scopeConfig: TEST_CONFIG,
      chatType: "direct",
    });
    expect(scope.tier).toBe("personal");
    expect(scope.project).toBeUndefined();
    expect(scope.isGroupSession).toBe(false);
  });

  it("uses config defaultTier", () => {
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:alice",
      scopeConfig: { defaultTier: "team" },
      chatType: "direct",
    });
    expect(scope.tier).toBe("team");
  });

  it("falls back to personal when no config provided", () => {
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:alice",
    });
    expect(scope.tier).toBe("personal");
  });

  it("respects session-level override for personal", () => {
    setScopeOverride("telegram:direct:alice", { tier: "personal" });
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:alice",
      scopeConfig: { defaultTier: "team" },
    });
    expect(scope.tier).toBe("personal");
  });

  it("respects session-level override for team", () => {
    setScopeOverride("telegram:direct:alice", { tier: "team" });
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:alice",
      scopeConfig: TEST_CONFIG,
    });
    expect(scope.tier).toBe("team");
  });

  it("resolves project scope with valid project ID", () => {
    setScopeOverride("telegram:direct:alice", { tier: "project", projectId: "webapp" });
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:alice",
      scopeConfig: TEST_CONFIG,
    });
    expect(scope.tier).toBe("project");
    expect(scope.project?.id).toBe("webapp");
    expect(scope.project?.name).toBe("Web Application");
  });

  it("falls through to default when override project is not found", () => {
    setScopeOverride("telegram:direct:alice", { tier: "project", projectId: "nonexistent" });
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:alice",
      scopeConfig: TEST_CONFIG,
    });
    expect(scope.tier).toBe("personal");
    expect(scope.project).toBeUndefined();
  });

  it("detects group session from chatType", () => {
    const scope = resolveScopeContext({
      sessionKey: "telegram:group:team-chat",
      scopeConfig: TEST_CONFIG,
      chatType: "group",
    });
    expect(scope.isGroupSession).toBe(true);
  });

  it("detects group session from session key", () => {
    const scope = resolveScopeContext({
      sessionKey: "slack:channel:general",
      scopeConfig: TEST_CONFIG,
    });
    expect(scope.isGroupSession).toBe(true);
  });

  it("uses explicit userId when provided", () => {
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:peer123",
      userId: "alice",
    });
    expect(scope.userId).toBe("alice");
  });

  it("extracts userId from session key last segment as fallback", () => {
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:peer123",
    });
    expect(scope.userId).toBe("peer123");
  });

  it("returns safe defaults when sessionKey is empty", () => {
    const scope = resolveScopeContext({ sessionKey: "" });
    expect(scope.tier).toBe("personal");
    expect(scope.isGroupSession).toBe(false);
    expect(scope.userId).toBe("unknown");
  });

  it("falls back to personal when project override exists but scopeConfig is undefined", () => {
    setScopeOverride("telegram:direct:alice", { tier: "project", projectId: "webapp" });
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:alice",
      scopeConfig: undefined,
    });
    // No scopeConfig means project can't be resolved — falls through to default
    expect(scope.tier).toBe("personal");
    expect(scope.project).toBeUndefined();
  });

  it("does not return project scope when override has project tier but no projectId", () => {
    setScopeOverride("telegram:direct:alice", { tier: "project" });
    const scope = resolveScopeContext({
      sessionKey: "telegram:direct:alice",
      scopeConfig: TEST_CONFIG,
    });
    // Should fall through to default since no projectId was provided
    expect(scope.tier).toBe("personal");
    expect(scope.project).toBeUndefined();
  });
});

describe("findProjectByName", () => {
  it("finds project by ID (case-insensitive)", () => {
    const project = findProjectByName("WEBAPP", TEST_CONFIG);
    expect(project?.id).toBe("webapp");
  });

  it("finds project by name (case-insensitive)", () => {
    const project = findProjectByName("web application", TEST_CONFIG);
    expect(project?.id).toBe("webapp");
  });

  it("returns undefined for unknown project", () => {
    expect(findProjectByName("nonexistent", TEST_CONFIG)).toBeUndefined();
  });

  it("returns undefined for empty name", () => {
    expect(findProjectByName("", TEST_CONFIG)).toBeUndefined();
  });

  it("returns undefined for whitespace-only name", () => {
    expect(findProjectByName("   ", TEST_CONFIG)).toBeUndefined();
  });

  it("returns undefined when no config", () => {
    expect(findProjectByName("webapp")).toBeUndefined();
  });
});

describe("listProjectNames", () => {
  it("returns project names", () => {
    expect(listProjectNames(TEST_CONFIG)).toEqual(["Web Application", "Infrastructure"]);
  });

  it("returns empty array when no config", () => {
    expect(listProjectNames()).toEqual([]);
  });

  it("returns empty array when no projects", () => {
    expect(listProjectNames({ defaultTier: "personal" })).toEqual([]);
  });
});
