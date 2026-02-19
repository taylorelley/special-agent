import { describe, expect, it } from "vitest";
import type { ScopeContext } from "../../src/scopes/types.js";
import {
  resolveRecallDatasets,
  resolveWriteDataset,
  resolveDatasets,
  classifyDataset,
  personalPrivateDataset,
  personalProfileDataset,
  projectDataset,
  TEAM_SHARED_DATASET,
  TEAM_PROPOSED_DATASET,
} from "./scoped-datasets.js";

describe("dataset name builders", () => {
  it("builds personal private dataset name", () => {
    expect(personalPrivateDataset("alice")).toBe("alice-private");
  });

  it("builds personal profile dataset name", () => {
    expect(personalProfileDataset("alice")).toBe("alice-profile");
  });

  it("builds project dataset name", () => {
    expect(projectDataset("webapp")).toBe("project-webapp");
  });
});

describe("resolveDatasets", () => {
  it("resolves all datasets for a personal scope", () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const datasets = resolveDatasets(scope);

    expect(datasets.personalPrivate).toBe("alice-private");
    expect(datasets.personalProfile).toBe("alice-profile");
    expect(datasets.project).toBeUndefined();
    expect(datasets.teamShared).toBe(TEAM_SHARED_DATASET);
    expect(datasets.teamProposed).toBe(TEAM_PROPOSED_DATASET);
  });

  it("resolves project dataset when project is set", () => {
    const scope: ScopeContext = {
      tier: "project",
      project: { id: "webapp", name: "Web App" },
      userId: "alice",
      isGroupSession: false,
    };
    const datasets = resolveDatasets(scope);
    expect(datasets.project).toBe("project-webapp");
  });
});

describe("resolveRecallDatasets", () => {
  it("returns private + profile for 1:1 personal scope", () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const datasets = resolveRecallDatasets(scope);

    expect(datasets).toEqual(["alice-private", "alice-profile"]);
  });

  it("returns private + profile + project + team-shared for 1:1 project scope", () => {
    const scope: ScopeContext = {
      tier: "project",
      project: { id: "webapp", name: "Web App" },
      userId: "alice",
      isGroupSession: false,
    };
    const datasets = resolveRecallDatasets(scope);

    expect(datasets).toEqual(["alice-private", "alice-profile", "project-webapp", "team-shared"]);
  });

  it("returns private + profile + team-shared for 1:1 team scope", () => {
    const scope: ScopeContext = { tier: "team", userId: "alice", isGroupSession: false };
    const datasets = resolveRecallDatasets(scope);

    expect(datasets).toEqual(["alice-private", "alice-profile", "team-shared"]);
  });

  it("excludes private in group session (personal scope)", () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: true };
    const datasets = resolveRecallDatasets(scope);

    expect(datasets).toEqual(["alice-profile"]);
    expect(datasets).not.toContain("alice-private");
  });

  it("excludes private in group session (project scope)", () => {
    const scope: ScopeContext = {
      tier: "project",
      project: { id: "webapp", name: "Web App" },
      userId: "alice",
      isGroupSession: true,
    };
    const datasets = resolveRecallDatasets(scope);

    expect(datasets).toEqual(["alice-profile", "project-webapp", "team-shared"]);
    expect(datasets).not.toContain("alice-private");
  });

  it("excludes private in group session (team scope)", () => {
    const scope: ScopeContext = { tier: "team", userId: "alice", isGroupSession: true };
    const datasets = resolveRecallDatasets(scope);

    expect(datasets).toEqual(["alice-profile", "team-shared"]);
    expect(datasets).not.toContain("alice-private");
  });
});

describe("resolveWriteDataset", () => {
  it("writes to personal private for personal scope", () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    expect(resolveWriteDataset(scope)).toBe("alice-private");
  });

  it("writes to project dataset for project scope", () => {
    const scope: ScopeContext = {
      tier: "project",
      project: { id: "webapp", name: "Web App" },
      userId: "alice",
      isGroupSession: false,
    };
    expect(resolveWriteDataset(scope)).toBe("project-webapp");
  });

  it("writes to team-proposed for team scope (governance staging)", () => {
    const scope: ScopeContext = { tier: "team", userId: "alice", isGroupSession: false };
    expect(resolveWriteDataset(scope)).toBe("team-proposed");
  });

  it("falls back to personal private when project scope has no project", () => {
    const scope: ScopeContext = { tier: "project", userId: "alice", isGroupSession: false };
    expect(resolveWriteDataset(scope)).toBe("alice-private");
  });
});

describe("classifyDataset", () => {
  it("classifies personal private dataset", () => {
    const result = classifyDataset("alice-private", "alice");
    expect(result).toEqual({ datasetName: "alice-private", tier: "personal", isPrivate: true });
  });

  it("classifies personal profile dataset", () => {
    const result = classifyDataset("alice-profile", "alice");
    expect(result).toEqual({ datasetName: "alice-profile", tier: "personal", isPrivate: false });
  });

  it("classifies project dataset", () => {
    const result = classifyDataset("project-webapp", "alice");
    expect(result).toEqual({ datasetName: "project-webapp", tier: "project", isPrivate: false });
  });

  it("classifies team-shared dataset", () => {
    const result = classifyDataset("team-shared", "alice");
    expect(result).toEqual({ datasetName: "team-shared", tier: "team", isPrivate: false });
  });

  it("classifies team-proposed dataset", () => {
    const result = classifyDataset("team-proposed", "alice");
    expect(result).toEqual({ datasetName: "team-proposed", tier: "team", isPrivate: false });
  });

  it("classifies unknown dataset as personal/private", () => {
    const result = classifyDataset("unknown-dataset", "alice");
    expect(result).toEqual({ datasetName: "unknown-dataset", tier: "personal", isPrivate: true });
  });
});
