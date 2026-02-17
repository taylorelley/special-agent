---
title: "Quick Start (Bare Metal)"
description: "Install Special Agent directly on a host and run the onboarding wizard"
---

# Quick Start (Bare Metal)

Install Special Agent directly on a Linux or macOS host without Docker.

## Prerequisites

- **Node.js 22** or newer (`node --version` to check)
- npm, pnpm, or bun as your package manager

## Install

```bash
npm install -g special-agent@latest
```

Or use the install script:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

## Run the onboarding wizard

```bash
special-agent onboard --install-daemon
```

The wizard walks through:

1. **Risk acknowledgement** — Special Agent runs tools with shell access
2. **Flow selection** — QuickStart (recommended) or Advanced
3. **Mode** — Local Gateway (runs on this machine) or Remote (connect to existing)
4. **Workspace** — directory for agent files, skills, and memory (default: `~/.special-agent/workspace`)
5. **Model provider** — choose **Custom Provider** (any OpenAI/Anthropic-compatible endpoint) or **Ollama**
6. **Gateway network** — port (default 18789), bind mode (loopback/lan/tailnet), auth (token/password)
7. **Channels** — configure Microsoft Teams or skip for WebChat-only
8. **Skills** — select bundled skills and install their dependencies
9. **Daemon install** — systemd (Linux) or launchd (macOS) service for auto-start

## Verify the Gateway

```bash
# Check if the daemon is running
special-agent gateway status

# Run health diagnostics
special-agent doctor
```

## Open the WebChat UI

```bash
special-agent dashboard
```

Or navigate to `http://127.0.0.1:18789/` directly.

## Send a test message

```bash
special-agent agent --message "Hello, what can you help me with?"
```

## Key file locations

| Path | Contents |
|------|----------|
| `~/.special-agent/special-agent.json` | Configuration file (JSON5) |
| `~/.special-agent/workspace/` | Agent workspace (skills, bootstrap files, memory) |
| `~/.special-agent/agents/` | Per-agent sessions and state |
| `~/.special-agent/logs/` | Gateway logs and command audit log |
| `~/.special-agent/skills/` | Managed (local) skills directory |

## Environment variables

Override default paths when running as a service account:

| Variable | Description |
|----------|-------------|
| `SPECIAL_AGENT_HOME` | Home directory for internal path resolution |
| `SPECIAL_AGENT_STATE_DIR` | Override the state directory |
| `SPECIAL_AGENT_CONFIG_PATH` | Override the config file path |

## nvm users (Linux)

The Gateway daemon runs as a systemd service with a minimal `PATH` that cannot source your shell profile. Create a `current` symlink after installing Node:

```bash
ln -sf "$NVM_DIR/versions/node/$(node -v)" "$NVM_DIR/current"
```

Then reinstall the daemon:

```bash
special-agent gateway install --force
```

## Next steps

- [Configuration](/deployment/configuration) — customize the JSON5 config
- [Gateway Operations](/deployment/gateway-operations) — manage the daemon, health checks, diagnostics
- [Skills Overview](/skills/overview) — understand the extension system
- [Microsoft Teams](/channels/microsoft-teams) — connect the bundled Teams channel
