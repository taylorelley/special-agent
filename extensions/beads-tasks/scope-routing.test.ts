import { describe, expect, it } from "vitest";
import type { ScopeContext } from "../../src/scopes/types.js";
import type { BeadsPluginConfig } from "./scope-routing.js";
import { resolveRepoPath, listConfiguredRepos, resolveBeadsConfig } from "./scope-routing.js";

// ---------------------------------------------------------------------------
// resolveRepoPath
// ---------------------------------------------------------------------------

describe("resolveRepoPath", () => {
  const config: BeadsPluginConfig = {
    personalRepoPath: "/home/alice/.beads/personal",
    teamRepoPath: "/shared/team-backlog",
    projectRepos: {
      webapp: "/projects/webapp/.beads",
      infra: "/projects/infra/.beads",
    },
  };

  it("returns personal repo for personal scope", () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const result = resolveRepoPath(scope, config);
    expect(result).toEqual({
      path: "/home/alice/.beads/personal",
      scope: "personal",
      label: "Personal tasks",
    });
  });

  it("returns default personal repo when no path configured", () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const result = resolveRepoPath(scope, {});
    expect(result).toBeDefined();
    expect(result!.path).toBe("~/.special-agent/tasks/personal");
    expect(result!.scope).toBe("personal");
  });

  it("returns project repo for project scope", () => {
    const scope: ScopeContext = {
      tier: "project",
      project: { id: "webapp", name: "Web App" },
      userId: "alice",
      isGroupSession: false,
    };
    const result = resolveRepoPath(scope, config);
    expect(result).toEqual({
      path: "/projects/webapp/.beads",
      scope: "project",
      label: "Project: Web App",
    });
  });

  it("falls back to project ID when name is missing", () => {
    const scope: ScopeContext = {
      tier: "project",
      project: { id: "webapp" } as { id: string; name: string },
      userId: "alice",
      isGroupSession: false,
    };
    const result = resolveRepoPath(scope, config);
    expect(result).toBeDefined();
    expect(result!.label).toBe("Project: webapp");
  });

  it("returns undefined for project scope without project ref", () => {
    const scope: ScopeContext = { tier: "project", userId: "alice", isGroupSession: false };
    const result = resolveRepoPath(scope, config);
    expect(result).toBeUndefined();
  });

  it("returns undefined for unconfigured project", () => {
    const scope: ScopeContext = {
      tier: "project",
      project: { id: "unknown", name: "Unknown" },
      userId: "alice",
      isGroupSession: false,
    };
    const result = resolveRepoPath(scope, config);
    expect(result).toBeUndefined();
  });

  it("returns team repo for team scope", () => {
    const scope: ScopeContext = { tier: "team", userId: "alice", isGroupSession: false };
    const result = resolveRepoPath(scope, config);
    expect(result).toEqual({
      path: "/shared/team-backlog",
      scope: "team",
      label: "Team backlog",
    });
  });

  it("returns undefined for team scope without team repo", () => {
    const scope: ScopeContext = { tier: "team", userId: "alice", isGroupSession: false };
    const result = resolveRepoPath(scope, {});
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listConfiguredRepos
// ---------------------------------------------------------------------------

describe("listConfiguredRepos", () => {
  it("lists all configured repos", () => {
    const config: BeadsPluginConfig = {
      personalRepoPath: "/personal",
      teamRepoPath: "/team",
      projectRepos: { webapp: "/webapp", infra: "/infra" },
    };
    const repos = listConfiguredRepos(config);
    expect(repos).toHaveLength(4);
    expect(repos.map((r) => r.scope)).toEqual(["personal", "project", "project", "team"]);
    // Verify labels
    expect(repos[0].label).toBe("Personal tasks");
    expect(repos[1].label).toBe("Project: webapp");
    expect(repos[2].label).toBe("Project: infra");
    expect(repos[3].label).toBe("Team backlog");
  });

  it("always includes default personal repo even with empty config", () => {
    const repos = listConfiguredRepos({});
    expect(repos).toHaveLength(1);
    expect(repos[0].scope).toBe("personal");
    expect(repos[0].path).toBe("~/.special-agent/tasks/personal");
  });

  it("uses explicit personal repo path when configured", () => {
    const repos = listConfiguredRepos({ personalRepoPath: "/p" });
    expect(repos).toHaveLength(1);
    expect(repos[0].scope).toBe("personal");
    expect(repos[0].path).toBe("/p");
  });
});

// ---------------------------------------------------------------------------
// resolveBeadsConfig
// ---------------------------------------------------------------------------

describe("resolveBeadsConfig", () => {
  it("parses valid config", () => {
    const raw = {
      personalRepoPath: "/personal",
      teamRepoPath: "/team",
      projectRepos: { webapp: "/webapp" },
      actorId: "agent-1",
      syncIntervalMs: 60000,
    };
    const config = resolveBeadsConfig(raw);
    expect(config.personalRepoPath).toBe("/personal");
    expect(config.teamRepoPath).toBe("/team");
    expect(config.projectRepos).toEqual({ webapp: "/webapp" });
    expect(config.actorId).toBe("agent-1");
    expect(config.syncIntervalMs).toBe(60000);
  });

  it("returns defaults for empty input", () => {
    const config = resolveBeadsConfig({});
    expect(config.personalRepoPath).toBeUndefined();
    expect(config.teamRepoPath).toBeUndefined();
    expect(config.projectRepos).toBeUndefined();
    expect(config.actorId).toBeUndefined();
    expect(config.syncIntervalMs).toBe(300000);
  });

  it("handles null/undefined input", () => {
    expect(resolveBeadsConfig(null).syncIntervalMs).toBe(300000);
    expect(resolveBeadsConfig(undefined).syncIntervalMs).toBe(300000);
  });

  it("ignores invalid field types", () => {
    const config = resolveBeadsConfig({
      personalRepoPath: 123,
      teamRepoPath: true,
      actorId: [],
      syncIntervalMs: "fast",
    });
    expect(config.personalRepoPath).toBeUndefined();
    expect(config.teamRepoPath).toBeUndefined();
    expect(config.actorId).toBeUndefined();
    expect(config.syncIntervalMs).toBe(300000);
  });

  it("filters out non-string values from projectRepos", () => {
    const config = resolveBeadsConfig({
      projectRepos: { webapp: "/ok", broken: 42 },
    });
    expect(config.projectRepos).toEqual({ webapp: "/ok" });
  });
});
