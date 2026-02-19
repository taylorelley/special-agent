/**
 * Scoped Dataset Resolution
 *
 * Maps scope context to Cognee dataset names and controls which datasets
 * are queried for recall vs. written to.
 *
 * Dataset naming convention:
 *   - Personal private:  "{userId}-private"
 *   - Personal profile:  "{userId}-profile"
 *   - Project:           "project-{projectId}"
 *   - Team shared:       "team-shared"
 *   - Team proposed:     "team-proposed"
 */

import type { ScopeContext, ScopeTier } from "../../src/scopes/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dataset names resolved for a scope context. */
export type ResolvedDatasets = {
  /** Private personal memory (conversation summaries, private notes). */
  personalPrivate: string;
  /** Profile — team-visible personal info (preferences, skills). */
  personalProfile: string;
  /** Project dataset name (only set when scope includes a project). */
  project?: string;
  /** Team shared (canonical team knowledge). */
  teamShared: string;
  /** Team proposed (staging area for governance). */
  teamProposed: string;
};

/** Identifies which dataset a search result came from. */
export type DatasetSource = {
  datasetName: string;
  tier: ScopeTier;
  isPrivate: boolean;
};

// ---------------------------------------------------------------------------
// Dataset name builders
// ---------------------------------------------------------------------------

export function personalPrivateDataset(userId: string): string {
  return `${userId}-private`;
}

export function personalProfileDataset(userId: string): string {
  return `${userId}-profile`;
}

export function projectDataset(projectId: string): string {
  return `project-${projectId}`;
}

export const TEAM_SHARED_DATASET = "team-shared";
export const TEAM_PROPOSED_DATASET = "team-proposed";

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all dataset names for a scope context.
 */
export function resolveDatasets(scope: ScopeContext): ResolvedDatasets {
  return {
    personalPrivate: personalPrivateDataset(scope.userId),
    personalProfile: personalProfileDataset(scope.userId),
    project: scope.project ? projectDataset(scope.project.id) : undefined,
    teamShared: TEAM_SHARED_DATASET,
    teamProposed: TEAM_PROPOSED_DATASET,
  };
}

/**
 * Determine which datasets to query for recall based on the current scope.
 *
 * Privacy rules:
 * - Personal private is NEVER recalled in group sessions.
 * - Personal profile is always available (team-visible preferences).
 * - Project dataset is included when scope is "project" or in a 1:1 session with active project.
 * - Team shared is included for project and team scopes.
 *
 * | Session type      | Scope    | Datasets queried                                  |
 * |-------------------|----------|---------------------------------------------------|
 * | 1:1, no project   | personal | private + profile                                 |
 * | 1:1, project set  | project  | private + profile + project + team-shared          |
 * | 1:1               | team     | private + profile + team-shared                   |
 * | Group, no project | personal | profile only                                      |
 * | Group, project    | project  | profile + project + team-shared                   |
 * | Group             | team     | profile + team-shared                             |
 */
export function resolveRecallDatasets(scope: ScopeContext): string[] {
  const datasets = resolveDatasets(scope);
  const result: string[] = [];

  // Personal private: only in 1:1 sessions
  if (!scope.isGroupSession) {
    result.push(datasets.personalPrivate);
  }

  // Personal profile: always available
  result.push(datasets.personalProfile);

  // Project dataset: when project scope is active
  if (scope.tier === "project" && datasets.project) {
    result.push(datasets.project);
  }

  // Team shared: for project and team scopes
  if (scope.tier === "project" || scope.tier === "team") {
    result.push(datasets.teamShared);
  }

  return result;
}

/**
 * Determine the write target dataset for new knowledge.
 * New knowledge goes to the dataset matching the current scope tier.
 */
export function resolveWriteDataset(scope: ScopeContext): string {
  const datasets = resolveDatasets(scope);

  switch (scope.tier) {
    case "project":
      return datasets.project ?? datasets.personalPrivate;
    case "team":
      return datasets.teamProposed; // Team writes go to staging
    default:
      return datasets.personalPrivate;
  }
}

/**
 * Classify which tier a dataset name belongs to.
 */
export function classifyDataset(datasetName: string, userId: string): DatasetSource {
  if (datasetName === personalPrivateDataset(userId)) {
    return { datasetName, tier: "personal", isPrivate: true };
  }
  if (datasetName === personalProfileDataset(userId)) {
    return { datasetName, tier: "personal", isPrivate: false };
  }
  if (datasetName.startsWith("project-")) {
    return { datasetName, tier: "project", isPrivate: false };
  }
  if (datasetName === TEAM_SHARED_DATASET || datasetName === TEAM_PROPOSED_DATASET) {
    return { datasetName, tier: "team", isPrivate: false };
  }
  // Unknown datasets are treated as personal/private for safety
  return { datasetName, tier: "personal", isPrivate: true };
}
