---
title: "Architecture Overview"
description: "Gateway architecture, components, and client flows for Special Agent Enterprise"
---

# Architecture Overview

## Gateway

The Gateway is a single long-lived Node.js process that serves as the control plane for all Special Agent operations. One Gateway per host.

**Responsibilities:**
- Maintain channel connections (Microsoft Teams via plugin, WebChat built-in)
- Expose a typed WebSocket API (requests, responses, server-push events)
- Manage agent sessions, tool execution, and memory
- Serve the WebChat and Control UI
- Host the canvas server (A2UI) on a separate port (default 18793)

**Default ports:**
- `18789` — Gateway WebSocket + HTTP API + WebChat UI
- `18793` — Canvas host (A2UI agent-editable workspace)

## Components

### Gateway (daemon)

- Validates inbound WebSocket frames against JSON Schema
- Emits events: `agent`, `chat`, `presence`, `health`, `heartbeat`, `cron`
- Exposes 91+ RPC methods over WebSocket
- Serves HTTP APIs (OpenAI-compatible, OpenResponses, Tools Invoke)

### Clients

Control-plane clients connect over WebSocket:

- **CLI** — `special-agent` command-line tool
- **WebChat** — built-in browser UI at the Gateway URL
- **Control UI** — admin dashboard (settings, sessions, health)
- **Automation** — cron jobs, webhooks, scripts

Clients send requests (`health`, `status`, `send`, `agent`) and subscribe to events (`tick`, `agent`, `presence`, `shutdown`).

### Nodes

Optional companion devices (macOS, iOS, Android, headless) connect to the same WebSocket server with `role: node`. Nodes provide device capabilities like camera, screen recording, and location.

### Channel plugins

Channel plugins (like Microsoft Teams) register with the Gateway at startup and handle inbound/outbound message delivery for their platform.

## Wire protocol

- **Transport**: WebSocket, text frames with JSON payloads
- **First frame must be `connect`** — includes auth token and device identity
- **Request/Response**: `{type:"req", id, method, params}` / `{type:"res", id, ok, payload|error}`
- **Events**: `{type:"event", event, payload, seq?, stateVersion?}`
- **Auth**: If `SPECIAL_AGENT_GATEWAY_TOKEN` is set, `connect.params.auth.token` must match
- **Idempotency**: Side-effecting methods (`send`, `agent`) require idempotency keys for safe retries

See [Gateway Protocol](/reference/gateway-protocol) for the full specification.

## Connection lifecycle

```
Client                          Gateway
  |                                |
  |--- req:connect (auth token) -->|
  |<-- res (ok, hello-ok) --------|  snapshot: presence + health
  |                                |
  |<-- event:presence -------------|
  |<-- event:tick -----------------|
  |                                |
  |--- req:agent (message) ------->|
  |<-- res:agent (ack, accepted) --|
  |<-- event:agent (streaming) ----|
  |<-- res:agent (final, summary) -|
```

## Agent runtime

When a message arrives (from Teams, WebChat, or API):

1. **Session resolution** — determine which agent and session handle this message (based on channel, account, peer routing rules)
2. **Context assembly** — load bootstrap files (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md), active skills, session history, and memory
3. **Model call** — send the assembled context to the configured model provider
4. **Tool execution** — if the model requests tool use, execute tools (optionally in a Docker sandbox) and return results
5. **Response delivery** — stream the response back through the originating channel

### Multi-agent routing

A single Gateway can host multiple agents, each with its own:
- Workspace directory and bootstrap files
- Session isolation and memory
- Sandbox configuration and tool policies
- Model provider and tool profile

Routing bindings map channels, accounts, or peers to specific agents.

## Security layers

```
Internet
  |
  v
[Network] ---- bind mode (loopback/lan/tailnet), firewall, TLS
  |
  v
[Auth] ------- gateway token or password, device pairing
  |
  v
[Agent] ------ tool policies (allow/deny), tool profiles
  |
  v
[Sandbox] ---- Docker container isolation, resource limits
  |
  v
[Tools] ------ exec, browser, filesystem — scoped per session
```

See [Security Overview](/security/overview) for details.

## Data flow

| Data | Location | Persistence |
|------|----------|-------------|
| Configuration | `~/.special-agent/special-agent.json` | JSON5 file, hot-reloadable |
| Sessions | `~/.special-agent/agents/<agentId>/sessions/` | Per-agent, per-session directories |
| Workspace | `~/.special-agent/workspace/` | Skills, bootstrap files, memory |
| Credentials | `~/.special-agent/` (various files) | Model API keys, channel tokens |
| Logs | `~/.special-agent/logs/` | Gateway logs, command audit log |
| Sandboxes | `~/.special-agent/sandboxes/` | Per-agent Docker workspace volumes |

## HTTP APIs

The Gateway exposes three HTTP API surfaces:

- **OpenAI-compatible** — `POST /v1/chat/completions` (streaming and non-streaming)
- **OpenResponses** — `POST /v1/responses` (SSE events, file/image input)
- **Tools Invoke** — direct tool invocation via HTTP

These enable programmatic integration without WebSocket connections.

## Related pages

- [Quick Start (Docker)](/getting-started/quickstart-docker)
- [Configuration](/deployment/configuration)
- [Security Overview](/security/overview)
- [Gateway Protocol](/reference/gateway-protocol)
- [Multi-Agent Routing](/reference/multi-agent)
