/**
 * Three-Tier Scope System Types
 *
 * Defines the scope type system for personal/project/team knowledge and task routing.
 * Every query, write, and permission check is scoped to one of these tiers.
 */

// ---------------------------------------------------------------------------
// Core scope types
// ---------------------------------------------------------------------------

/** The three knowledge/task tiers. */
export type ScopeTier = "personal" | "project" | "team";

/** Reference to a configured project. */
export type ProjectRef = {
  /** Unique project identifier (slug, e.g. "webapp"). */
  id: string;
  /** Human-readable project name. */
  name: string;
  /** Optional list of team member user IDs with access to this project. */
  members?: string[];
};

/**
 * Resolved scope context for the current session.
 * Built by the scope resolver from session metadata, config, and user overrides.
 */
export type ScopeContext = {
  /** Active scope tier. */
  tier: ScopeTier;
  /** Active project (only set when tier === "project"). */
  project?: ProjectRef;
  /** User identity derived from session peer/owner. */
  userId: string;
  /** Whether this is a group/channel session (affects privacy rules). */
  isGroupSession: boolean;
};

// ---------------------------------------------------------------------------
// Configuration types (for special-agent.json)
// ---------------------------------------------------------------------------

/** Beads task tracker configuration per scope. */
export type BeadsConfig = {
  /** Enable beads task integration. */
  enabled?: boolean;
  /** Repo paths for non-project scopes. */
  repos?: {
    /** Personal task repo path (default: ~/.special-agent/tasks/personal). */
    personal?: string;
    /** Team backlog repo path. */
    team?: string;
  };
  /** Map of project ID → beads repo path. */
  projectRepos?: Record<string, string>;
};

/** Top-level scope configuration in special-agent.json. */
export type ScopeConfig = {
  /** Default scope tier for new sessions (default: "personal"). */
  defaultTier?: ScopeTier;
  /** Configured projects. */
  projects?: ProjectRef[];
  /** Team-level configuration. */
  team?: {
    /** Team name. */
    name?: string;
    /** Enable team knowledge governance flow (proposed → shared). */
    governance?: boolean;
  };
  /** Beads task tracker integration. */
  beads?: BeadsConfig;
};
