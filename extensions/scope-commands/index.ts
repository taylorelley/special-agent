/**
 * Scope Commands Extension
 *
 * Registers /personal, /project, /team commands for switching the active scope tier.
 * Also registers a before_agent_start hook that resolves the current scope context
 * and injects it into the agent prompt via prependContext.
 */

import type { SpecialAgentPluginApi } from "special-agent/plugin-sdk";
import type { ScopeContext } from "../../src/scopes/types.js";
import {
  resolveScopeContext,
  findProjectByName,
  listProjectNames,
} from "../../src/scopes/resolver.js";
import { setScopeOverride, clearScopeOverride } from "../../src/scopes/session-state.js";

/**
 * Format a scope context for display to the user.
 */
function formatScopeLabel(scope: ScopeContext): string {
  if (scope.tier === "project" && scope.project) {
    return `project (${scope.project.name})`;
  }
  return scope.tier;
}

/** Redact a session key for safe logging (keep last 4 chars). */
function redactSessionKey(key: string): string {
  if (key.length <= 4) return "****";
  return `****${key.slice(-4)}`;
}

export default function register(api: SpecialAgentPluginApi) {
  const log = api.logger;

  // -------------------------------------------------------------------------
  // /personal — switch to personal scope
  // -------------------------------------------------------------------------
  api.registerCommand({
    name: "personal",
    description: "Switch to personal scope (private knowledge and tasks)",
    acceptsArgs: false,
    handler(ctx) {
      if (!ctx.sessionKey) {
        return { text: "Cannot set scope: no session key available." };
      }
      setScopeOverride(ctx.sessionKey, { tier: "personal" });
      log.debug?.(`Scope set to personal for session ${redactSessionKey(ctx.sessionKey)}`);
      return {
        text: "Scope set to **personal**. Knowledge and tasks now route to your personal stores.",
      };
    },
  });

  // -------------------------------------------------------------------------
  // /project <name> — switch to project scope
  // -------------------------------------------------------------------------
  api.registerCommand({
    name: "project",
    description: "Switch to a project scope (/project <name>)",
    acceptsArgs: true,
    handler(ctx) {
      if (!ctx.sessionKey) {
        return { text: "Cannot set scope: no session key available." };
      }
      const scopeConfig = ctx.config?.scopes;
      const projectName = ctx.args?.trim();

      if (!projectName) {
        const names = listProjectNames(scopeConfig);
        if (names.length === 0) {
          return {
            text: "No projects configured. Add projects to `scopes.projects` in your special-agent.json config.",
          };
        }
        return {
          text: `Usage: /project <name>\n\nAvailable projects: ${names.join(", ")}`,
        };
      }

      const project = findProjectByName(projectName, scopeConfig);
      if (!project) {
        const names = listProjectNames(scopeConfig);
        const available = names.length > 0 ? `\n\nAvailable: ${names.join(", ")}` : "";
        return {
          text: `Project "${projectName}" not found.${available}`,
        };
      }

      setScopeOverride(ctx.sessionKey, { tier: "project", projectId: project.id });
      log.debug?.(
        `Scope set to project "${project.name}" for session ${redactSessionKey(ctx.sessionKey)}`,
      );
      return {
        text: `Scope set to **project (${project.name})**. Knowledge and tasks now route to the project stores.`,
      };
    },
  });

  // -------------------------------------------------------------------------
  // /team — switch to team scope
  // -------------------------------------------------------------------------
  api.registerCommand({
    name: "team",
    description: "Switch to team scope (shared standards, cross-project tasks)",
    acceptsArgs: false,
    handler(ctx) {
      if (!ctx.sessionKey) {
        return { text: "Cannot set scope: no session key available." };
      }
      setScopeOverride(ctx.sessionKey, { tier: "team" });
      log.debug?.(`Scope set to team for session ${redactSessionKey(ctx.sessionKey)}`);
      return { text: "Scope set to **team**. Knowledge and tasks now route to the team stores." };
    },
  });

  // -------------------------------------------------------------------------
  // /scope — show current scope (read-only, no side effects)
  // -------------------------------------------------------------------------
  api.registerCommand({
    name: "scope",
    description: "Show the current active scope",
    acceptsArgs: false,
    handler(ctx) {
      if (!ctx.sessionKey) {
        return { text: "No session key available." };
      }
      const scope = resolveScopeContext({
        sessionKey: ctx.sessionKey,
        scopeConfig: ctx.config?.scopes,
      });
      return {
        text: `Current scope: **${formatScopeLabel(scope)}**${scope.isGroupSession ? " (group session)" : ""}`,
      };
    },
  });

  // -------------------------------------------------------------------------
  // /scope-clear — clear override, revert to config default
  // -------------------------------------------------------------------------
  api.registerCommand({
    name: "scope-clear",
    description: "Clear scope override and revert to config default",
    acceptsArgs: false,
    handler(ctx) {
      if (!ctx.sessionKey) {
        return { text: "No session key available." };
      }
      clearScopeOverride(ctx.sessionKey);
      const scope = resolveScopeContext({
        sessionKey: ctx.sessionKey,
        scopeConfig: ctx.config?.scopes,
      });
      return {
        text: `Scope override cleared. Active scope: **${formatScopeLabel(scope)}** (config default).`,
      };
    },
  });

  // TODO: Evict scope overrides on session end. PluginHookSessionContext
  // exposes sessionId, not sessionKey (used to key overrides). Once the
  // plugin framework surfaces sessionKey in session_end, register a hook:
  //   api.on("session_end", (_event, ctx) => clearScopeOverride(ctx.sessionKey))
  // Until then, overrides are ephemeral (cleared on gateway restart via the
  // in-memory Map in session-state.ts).

  // -------------------------------------------------------------------------
  // before_agent_start hook — inject scope context into agent prompt
  // -------------------------------------------------------------------------
  api.on("before_agent_start", (_event, ctx) => {
    if (!ctx.sessionKey) {
      return;
    }
    // TODO: PluginHookAgentContext doesn't carry the agent config's scopeConfig.
    // The scope resolver reads from session state (overrides set by the commands
    // above) and falls back to defaults. Once the hook context carries config,
    // pass ctx.config?.scopes here for full defaultTier/project resolution.
    const scopeConfig = undefined;

    const scope = resolveScopeContext({
      sessionKey: ctx.sessionKey,
      scopeConfig,
    });

    // Populate the hook context scope field for downstream consumers
    ctx.scope = scope;

    // Inject a lightweight scope indicator into the agent's context
    const label = formatScopeLabel(scope);
    const groupNote = scope.isGroupSession ? " | Group session: private memory excluded." : "";
    const prependContext = `<scope_context>Active scope: ${label}${groupNote}</scope_context>`;

    return { prependContext };
  });

  log.info("Scope commands registered: /personal, /project, /team, /scope, /scope-clear");
}
