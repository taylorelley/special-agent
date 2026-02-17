---
title: "Introduction"
description: "Special Agent Enterprise — self-hosted AI assistant gateway for organizations"
---

# Special Agent Enterprise

Special Agent is a self-hosted AI assistant gateway designed for enterprise deployment. It provides a single long-lived process — the **Gateway** — that connects your organization's messaging channels to AI model providers, with a skills-based extension system for building custom capabilities in-house.

## What Special Agent does

- Runs a **local-first Gateway** on your infrastructure (Docker, bare metal, or Kubernetes)
- Connects to **Microsoft Teams** (bundled) and a **built-in WebChat UI** out of the box
- Routes conversations through an **agent runtime** that manages sessions, context, memory, and tool execution
- Extends via **custom skills** (markdown-based instruction files) and **plugins** (TypeScript extensions)
- Supports **multi-agent routing** — isolate different teams, use cases, or security profiles within a single Gateway

## Architecture at a glance

```
+------------------+       +------------------+       +-------------------+
|  Microsoft Teams |------>|                  |------>| Model Provider    |
|  (bundled plugin)|       |     Gateway      |       | (OpenAI-compat,   |
+------------------+       |                  |       |  Anthropic, Ollama)|
                           |  - Agent Runtime |       +-------------------+
+------------------+       |  - Sessions      |
|  WebChat         |------>|  - Skills        |       +-------------------+
|  (built-in UI)   |       |  - Plugins       |------>| Tools             |
+------------------+       |  - Hooks         |       | (exec, browser,   |
                           |  - Automation    |       |  canvas, custom)  |
+------------------+       |                  |       +-------------------+
|  Custom Channels |------>|  WebSocket API   |
|  (via plugins)   |       |  HTTP APIs       |
+------------------+       +------------------+
```

## Key components

### Gateway
The control plane. A single Node.js process that owns all channel connections, agent sessions, tool execution, and configuration. Communicates with clients over WebSocket (port 18789 by default).

### Channels
Message transport adapters. **Microsoft Teams** ships as a bundled plugin. **WebChat** is built into the Gateway. Additional channels can be added via the plugin system.

### Agent Runtime
Manages conversations with AI models. Handles session scoping, context assembly (bootstrap files like AGENTS.md, SOUL.md, TOOLS.md), extended thinking, streaming responses, and tool invocation.

### Skills
The primary extension mechanism. A skill is a directory containing a `SKILL.md` file with YAML frontmatter and natural-language instructions that teach the agent how to use tools. Skills are loaded from bundled, managed, workspace, and extra directories with configurable precedence.

### Plugins
TypeScript extensions that register tools, hooks, channels, services, commands, HTTP routes, and gateway methods. More powerful than skills but require code. The 10 bundled extensions (including Teams, memory, diagnostics, and workflow tools) are all implemented as plugins.

### Hooks
Event-driven callbacks that fire on agent lifecycle events, messages, tool calls, sessions, and gateway events. Used for audit logging, memory management, and custom automation.

## Model provider support

The onboarding wizard offers two provider configurations:

- **Custom Provider** — any OpenAI-compatible or Anthropic-compatible API endpoint (corporate API gateways, Azure OpenAI, self-hosted models)
- **Ollama** — local model inference

The runtime supports OpenAI Completions, OpenAI Responses, Anthropic Messages, and Google Generative AI protocols. Embedding providers (for memory/RAG) include OpenAI, Google Gemini, Voyage AI, and local GGUF models.

## What ships out of the box

| Category | Included |
|----------|----------|
| Channels | Microsoft Teams (plugin), WebChat (built-in) |
| Extensions | 10 bundled (memory, workflow, diagnostics, device control, voice, prose) |
| Skills | 12 bundled (GitHub, coding agent, health check, summarize, session logs, and more) |
| Hooks | 4 bundled (session memory, command logger, boot-md, soul-evil) |
| HTTP APIs | OpenAI-compatible, OpenResponses, Tools Invoke, Webhooks |
| Agent tools | ~17 built-in (exec, browser, canvas, cron, sessions, web search/fetch, and more) |

## Designed for enterprise extension

Special Agent is intentionally minimal out of the box. The expectation is that your organization will:

1. **Build custom skills** that integrate with internal systems (databases, APIs, approval workflows)
2. **Develop plugins** for deeper integrations (custom channels, tools, services)
3. **Configure security** with sandboxing, tool policies, and network controls appropriate to your environment

See [Custom Skill Development](/skills/overview) for the primary extension path.

## Next steps

- [Architecture Overview](/getting-started/architecture) — deeper dive into Gateway internals
- [Quick Start (Docker)](/getting-started/quickstart-docker) — run a Gateway in 10 minutes
- [Quick Start (Bare Metal)](/getting-started/quickstart-bare-metal) — install directly on a host
