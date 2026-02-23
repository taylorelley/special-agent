/**
 * Beads Scope Routing
 *
 * Maps scope context to the appropriate beads repository path.
 */

import type { ScopeContext } from "../../src/scopes/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BeadsPluginConfig = {
  personalRepoPath?: string;
  teamRepoPath?: string;
  projectRepos?: Record<string, string>;
  actorId?: string;
  syncIntervalMs?: number;
};

export type ResolvedRepoPath = {
  path: string;
  scope: "personal" | "project" | "team";
  label: string;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PERSONAL_REPO = "~/.special-agent/tasks/personal";
const DEFAULT_SYNC_INTERVAL_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the beads repo path for the current scope context.
 * Returns undefined if no repo is configured for the scope.
 */
export function resolveRepoPath(
  scope: ScopeContext,
  config: BeadsPluginConfig,
): ResolvedRepoPath | undefined {
  switch (scope.tier) {
    case "personal":
      return {
        path: config.personalRepoPath || DEFAULT_PERSONAL_REPO,
        scope: "personal",
        label: "Personal tasks",
      };

    case "project": {
      if (!scope.project) return undefined;
      const projectPath = config.projectRepos?.[scope.project.id];
      if (!projectPath) return undefined;
      return {
        path: projectPath,
        scope: "project",
        label: `Project: ${scope.project.name ?? scope.project.id}`,
      };
    }

    case "team":
      if (!config.teamRepoPath) return undefined;
      return {
        path: config.teamRepoPath,
        scope: "team",
        label: "Team backlog",
      };

    default:
      return undefined;
  }
}

/**
 * List all configured repo paths with their scope labels.
 * Always includes a personal repo entry (using the default path if unconfigured).
 */
export function listConfiguredRepos(config: BeadsPluginConfig): ResolvedRepoPath[] {
  const repos: ResolvedRepoPath[] = [];

  // Always include personal repo (falls back to default path)
  repos.push({
    path: config.personalRepoPath || DEFAULT_PERSONAL_REPO,
    scope: "personal",
    label: "Personal tasks",
  });

  if (config.projectRepos) {
    for (const [projectId, path] of Object.entries(config.projectRepos)) {
      repos.push({
        path,
        scope: "project",
        label: `Project: ${projectId}`,
      });
    }
  }

  if (config.teamRepoPath) {
    repos.push({
      path: config.teamRepoPath,
      scope: "team",
      label: "Team backlog",
    });
  }

  return repos;
}

/**
 * Resolve plugin config from raw plugin config.
 */
export function resolveBeadsConfig(rawConfig: unknown): BeadsPluginConfig {
  const raw =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? (rawConfig as BeadsPluginConfig)
      : {};

  // Validate projectRepos: keep only entries where value is a string
  let projectRepos: Record<string, string> | undefined;
  if (raw.projectRepos && typeof raw.projectRepos === "object") {
    const validated: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.projectRepos)) {
      if (typeof value === "string") {
        validated[key] = value;
      }
    }
    projectRepos = Object.keys(validated).length > 0 ? validated : undefined;
  }

  return {
    personalRepoPath: typeof raw.personalRepoPath === "string" ? raw.personalRepoPath : undefined,
    teamRepoPath: typeof raw.teamRepoPath === "string" ? raw.teamRepoPath : undefined,
    projectRepos,
    actorId: typeof raw.actorId === "string" ? raw.actorId : undefined,
    syncIntervalMs:
      typeof raw.syncIntervalMs === "number" ? raw.syncIntervalMs : DEFAULT_SYNC_INTERVAL_MS,
  };
}
