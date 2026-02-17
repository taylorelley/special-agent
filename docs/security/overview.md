---
title: "Security Overview"
description: "Threat model, trust hierarchy, and security architecture for Special Agent Enterprise"
---

# Security Overview

Special Agent runs an AI agent with access to shell commands, file operations, browser automation, and network access. Security is not optional — it is the foundation of every deployment decision.

## Core principle: access control before intelligence

The agent's capabilities are determined by its tool policy, sandbox configuration, and network access — not by the model's judgment. Security controls are enforced at the Gateway level, before any model interaction occurs.

## Threat model

### What Special Agent is

A self-hosted gateway that bridges messaging channels to AI model providers, with tool execution capabilities. It runs on your infrastructure, under your control.

### Trust hierarchy

```
Most trusted
  |
  v  Gateway operator (you) — full config, credential, and tool access
  |
  v  Gateway auth (token/password) — controls WebSocket/HTTP access
  |
  v  Channel auth (Teams app registration) — controls who can message the agent
  |
  v  DM policy (pairing/allowlist/open) — controls which users get responses
  |
  v  Tool policy (allow/deny lists) — controls what the agent can do
  |
  v  Sandbox (Docker isolation) — constrains tool execution blast radius
  |
Least trusted
  v  End users sending messages via channels
```

### Attack surfaces

| Surface | Risk | Mitigation |
|---------|------|------------|
| Gateway WebSocket/HTTP | Unauthorized access to agent and tools | Token or password auth, bind to loopback/tailnet |
| Channel messages | Prompt injection, unauthorized commands | DM policies, tool policies, sandbox |
| Tool execution | Arbitrary code execution, data exfiltration | Sandbox isolation, tool allow/deny lists, network restrictions |
| Credentials on disk | API key theft | File permissions (600), env var injection, secret rotation |
| Model provider API | Data sent to external API | Choose provider carefully, use on-prem models (Ollama) for sensitive data |
| Plugin/skill code | Malicious extensions | Review all custom code, restrict skill directories |

## Security audit

Run the built-in security audit to check your configuration:

```bash
special-agent security audit
```

For a detailed report with fix suggestions:

```bash
special-agent security audit --deep --fix
```

The audit checks gateway auth, bind mode, DM policies, tool policies, credential permissions, and sandbox configuration.

## Security checklist (priority order)

1. **Enable gateway auth** — set a token or password via the onboarding wizard or config
2. **Bind to loopback or tailnet** — never expose the Gateway to the public internet without auth
3. **Configure DM policy** — use `pairing` or `allowlist` mode, not `open`
4. **Enable sandboxing** — run tool execution in Docker containers with resource limits
5. **Set tool policies** — deny tools the agent does not need (browser, canvas, nodes)
6. **Restrict credentials** — ensure `~/.special-agent/` files have `600` permissions
7. **Review skills and plugins** — audit all custom code before deployment
8. **Enable audit logging** — the bundled `command-logger` hook writes to `~/.special-agent/logs/commands.log`

## DM access model

Controls who can interact with the agent through messaging channels:

| Mode | Behavior |
|------|----------|
| `pairing` | New senders must be approved before getting responses (recommended) |
| `allowlist` | Only pre-approved sender IDs get responses |
| `open` | Anyone who can message the channel gets responses (not recommended for production) |
| `disabled` | Channel ignores all DMs |

Configure per channel in `channels.<channelId>.dm.policy`.

## Command authorization

Every inbound message flows through:

1. **Channel auth** — is the sender authenticated by the channel platform?
2. **DM policy** — is the sender approved (pairing/allowlist)?
3. **Session resolution** — which agent and session handle this message?
4. **Tool policy** — which tools can this agent use?
5. **Sandbox** — if enabled, tools execute in an isolated container

## Related pages

- [Authentication & Authorization](/security/authentication) — gateway auth modes, reverse proxy setup
- [Sandboxing](/security/sandboxing) — Docker container isolation for tool execution
- [Tool Policy & Access Control](/security/tool-policy) — allow/deny lists, tool profiles
- [Network Security](/security/network) — bind modes, Tailscale, firewall
- [Audit Logging](/security/audit-logging) — command logger, transcript storage
