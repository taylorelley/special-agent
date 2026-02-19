/**
 * Scope Session State
 *
 * In-memory store for per-session scope overrides set by /personal, /project, /team commands.
 * Scope state is ephemeral — it resets when the gateway restarts.
 */

import type { ScopeTier } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A scope override set by a user command. */
export type ScopeOverride = {
  /** The overridden scope tier. */
  tier: ScopeTier;
  /** Project ID when tier is "project". */
  projectId?: string;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Per-session scope overrides keyed by session key. */
const overrides = new Map<string, ScopeOverride>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the scope override for a session, if any. */
export function getScopeOverride(sessionKey: string): ScopeOverride | undefined {
  return overrides.get(sessionKey);
}

/** Set or replace the scope override for a session. */
export function setScopeOverride(sessionKey: string, override: ScopeOverride): void {
  overrides.set(sessionKey, override);
}

/** Clear the scope override for a session (reverts to config default). */
export function clearScopeOverride(sessionKey: string): void {
  overrides.delete(sessionKey);
}

/** Clear all scope overrides. Useful for testing or gateway restart. */
export function clearAllScopeOverrides(): void {
  overrides.clear();
}

/** Get the number of active overrides (for diagnostics). */
export function getScopeOverrideCount(): number {
  return overrides.size;
}
