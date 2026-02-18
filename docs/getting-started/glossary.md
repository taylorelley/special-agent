---
title: "Key Concepts Glossary"
description: "Definitions of core Special Agent concepts and terminology"
---

# Key Concepts Glossary

## Gateway

The central control plane process. A single long-lived Node.js server that manages all channel connections, agent sessions, tool execution, configuration, and client communication. Communicates over WebSocket (default port 18789) and HTTP.

## Channel

A message transport adapter that connects the Gateway to an external messaging platform. **Microsoft Teams** is the only bundled channel plugin. **WebChat** is built into the Gateway. Additional channels can be added via the plugin system.

## Agent

A configured AI assistant identity within the Gateway. Each agent has its own workspace directory, bootstrap files (AGENTS.md, SOUL.md, TOOLS.md), model configuration, tool policies, and session isolation. A single Gateway can host multiple agents via multi-agent routing.

## Session

A conversation context between a user and an agent. Sessions track message history, tool invocations, and state. Sessions are scoped by channel, account, and peer — direct messages typically share a `main` session while group conversations get isolated sessions.

## Skill

A directory containing a `SKILL.md` file that teaches the agent how to use tools through natural-language instructions and YAML frontmatter metadata. Skills are the primary extension mechanism — they require no code, just markdown. Loaded from bundled, managed (`~/.special-agent/skills/`), workspace, and extra directories.

## Plugin

A TypeScript extension that registers capabilities with the Gateway at startup. Plugins can provide tools, hooks, channels, services, commands, HTTP routes, and gateway methods. More powerful than skills but require code. All 10 bundled extensions (including Teams, memory, and diagnostics) are plugins.

## Hook

An event-driven callback that fires on Gateway lifecycle events. Hooks respond to events like `command:new`, `gateway:startup`, `agent:bootstrap`, and tool invocations. Used for audit logging (`command-logger`), memory management (`session-memory`), and custom automation.

## Tool

A capability that the agent can invoke during a conversation. Built-in tools include `exec` (shell commands), `browser` (Chrome automation), `read`/`write`/`edit` (filesystem), `canvas` (A2UI visual workspace), and `web_fetch`/`web_search`. Skills and plugins can register additional tools.

## Tool Profile

A preset configuration that controls which tools are available to the agent. Profiles range from `minimal` (text-only) to `full` (all tools). Tool profiles can be overridden per model provider via `tools.byProvider`.

## Workspace

A directory (`~/.special-agent/workspace/` by default) that contains an agent's bootstrap files, custom skills, memory data, and working files. In multi-agent setups, each agent has its own workspace.

## Bootstrap Files

Markdown files in the workspace that configure the agent's behavior:

- **AGENTS.md** — agent definitions and routing rules
- **SOUL.md** — personality and behavioral instructions
- **TOOLS.md** — tool usage guidance
- **IDENTITY.md** — agent identity and context
- **USER.md** — user preferences and context
- **BOOT.md** — instructions run on gateway startup
- **HEARTBEAT.md** — periodic check-in instructions

## Sandbox

Docker-based isolation for tool execution. When enabled, tools like `exec`, `read`, `write`, and `edit` run inside a container with configurable resource limits (memory, CPU, PIDs), network restrictions, and filesystem access controls. Sandboxing reduces the blast radius of agent actions.

## Canvas (A2UI)

An agent-driven visual workspace served on a separate port (default 18793). Agents can create and manipulate interactive HTML content, render charts, display data, and build UI elements in real time during conversations.

## Node

A companion device (macOS, iOS, Android, or headless) that connects to the Gateway over WebSocket with `role: node`. Nodes expose device capabilities like camera, screen recording, and location services.

## RPC

The typed request/response protocol used over WebSocket between clients and the Gateway. The Gateway exposes 91+ RPC methods covering configuration, channels, models, agents, skills, sessions, cron, voice, and tool execution.

## Related pages

- [Architecture Overview](/getting-started/architecture)
- [Skills Overview](/skills/overview)
- [Plugin System Overview](/plugins/overview)
- [Security Overview](/security/overview)
