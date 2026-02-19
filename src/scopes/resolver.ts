/**
 * Scope Resolver
 *
 * Derives a ScopeContext from session metadata, configuration, and user overrides.
 * This is the single entry point for determining what scope a session is operating in.
 */

import type { ScopeConfig, ScopeContext, ScopeTier } from "./types.js";
import { getScopeOverride } from "./session-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolveScopeParams = {
  /** Session key (encodes channel, chat type, peer). */
  sessionKey: string;
  /** Scope configuration from special-agent.json. */
  scopeConfig?: ScopeConfig;
  /** Chat type from session metadata (e.g. "direct", "group", "channel"). */
  chatType?: string;
  /** User/peer identifier from the session. */
  userId?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine if a session is a group session from chat type or session key.
 * Mirrors the logic in src/auto-reply/status.ts and src/auto-reply/reply/session.ts.
 */
export function isGroupSession(chatType?: string, sessionKey?: string): boolean {
  if (chatType === "group" || chatType === "channel") {
    return true;
  }
  if (sessionKey?.includes(":group:") || sessionKey?.includes(":channel:")) {
    return true;
  }
  return false;
}

/**
 * Extract a user identifier from the session key.
 * Session keys follow patterns like "channel:chatType:peerId" or similar.
 * Falls back to the explicit userId param or "unknown".
 */
function resolveUserId(sessionKey: string, explicitUserId?: string): string {
  if (explicitUserId) {
    return explicitUserId;
  }
  // Session keys are colon-separated; the last segment is typically the peer ID.
  const parts = sessionKey.split(":");
  return parts.length > 0 ? parts[parts.length - 1] : "unknown";
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the scope context for a session.
 *
 * Priority:
 * 1. Session-level override (set by /personal, /project, /team commands)
 * 2. Config default tier
 * 3. Fallback to "personal"
 *
 * Group sessions always flag isGroupSession=true regardless of tier,
 * which the knowledge layer uses to enforce privacy rules.
 */
export function resolveScopeContext(params: ResolveScopeParams): ScopeContext {
  const { sessionKey, scopeConfig, chatType, userId } = params;
  const resolvedUserId = resolveUserId(sessionKey, userId);
  const isGroup = isGroupSession(chatType, sessionKey);

  // Check for session-level override first
  const override = getScopeOverride(sessionKey);
  if (override) {
    const tier = override.tier;
    if (tier === "project" && override.projectId) {
      const project = scopeConfig?.projects?.find((p) => p.id === override.projectId);
      if (project) {
        return { tier, project, userId: resolvedUserId, isGroupSession: isGroup };
      }
      // Project not found in config — fall through to default
    } else {
      return { tier, userId: resolvedUserId, isGroupSession: isGroup };
    }
  }

  // Use config default or "personal"
  const defaultTier: ScopeTier = scopeConfig?.defaultTier ?? "personal";
  return { tier: defaultTier, userId: resolvedUserId, isGroupSession: isGroup };
}

/**
 * Find a project by name (case-insensitive) in the scope config.
 * Returns the project ref or undefined if not found.
 */
export function findProjectByName(
  name: string,
  scopeConfig?: ScopeConfig,
): { id: string; name: string; members?: string[] } | undefined {
  if (!scopeConfig?.projects || !name.trim()) {
    return undefined;
  }
  const normalized = name.trim().toLowerCase();
  return scopeConfig.projects.find(
    (p) => p.id.toLowerCase() === normalized || p.name.toLowerCase() === normalized,
  );
}

/**
 * List available project names for display.
 */
export function listProjectNames(scopeConfig?: ScopeConfig): string[] {
  return (scopeConfig?.projects ?? []).map((p) => p.name || p.id);
}
