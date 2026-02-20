# Scope Commands (plugin)

Registers slash commands for switching the active scope tier and a
`before_agent_start` hook that injects scope context into the agent prompt.

## Commands

| Command           | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `/personal`       | Switch to personal scope (private knowledge and tasks)       |
| `/project <name>` | Switch to a named project scope                              |
| `/team`           | Switch to team scope (shared standards, cross-project tasks) |
| `/scope`          | Show current active scope                                    |
| `/scope-clear`    | Clear scope override, revert to config default               |

## Enable

This extension is bundled and activated automatically when the `scopes`
configuration block is present in `special-agent.json`.

## How it works

1. Slash commands set a per-session scope override via `setScopeOverride()`.
2. The `before_agent_start` hook resolves the full `ScopeContext` from
   session metadata, config, and overrides.
3. The resolved scope is injected into the agent prompt via `prependContext`
   and attached to the hook context (`ctx.scope`) for downstream consumers
   (e.g., memory-cognee, beads-tasks).

## Privacy in Group Sessions

When the session is a group/channel session, the hook adds a note to the
agent prompt indicating that private memory is excluded. This ensures the
agent is aware of the privacy boundary and does not reference private content.

## Session Behavior

- Scope overrides are **per-session** and stored in memory.
- Overrides do not persist across gateway restarts.
- The default scope tier (from config) applies when no override is set.

## Bundled extension note

This extension depends on Special Agent internal modules (`src/scopes/`).
It ships as a bundled extension and is not designed for standalone installation.
