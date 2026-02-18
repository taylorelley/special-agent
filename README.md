# ✈️ Special Agent ✈️ — Personal AI Assistant

**Special Agent** is a personal AI assistant you run on your own devices. It connects to messaging channels via a plugin-based architecture, provides a built-in WebChat UI, and supports voice interaction on macOS/iOS/Android. The Gateway is the control plane — the product is the assistant.

**Special Agent** is a minimal fork of the OpenClaw project designed for enterprise environments. It provides a controlled baseline with a small, curated set of core skills and plugins.
The project is built to be extended. It is intended to be paired with an internally hosted SkillHub, where organizations can create and make available use case–specific skills and plugins.

By default, the configuration is more restricted than OpenClaw to support governance and security requirements. However, all OpenClaw functionality can be enabled through configuration changes or by adding the appropriate skills and plugins.

## Features

- **Local-first Gateway** — single WebSocket control plane for sessions, channels, tools, and events
- **Plugin-based channels** — Microsoft Teams (bundled), WebChat (built-in), and extensible plugin architecture
- **Multi-agent routing** — route inbound channels/accounts/peers to isolated agents with per-session workspaces
- **Voice Wake + Talk Mode** — always-on speech for macOS/iOS/Android with ElevenLabs
- **Live Canvas** — agent-driven visual workspace with A2UI
- **Browser control** — dedicated Chrome/Chromium automation via CDP
- **Skills platform** — bundled, managed, and workspace skills with install gating
- **Companion apps** — macOS menu bar app, iOS and Android nodes
- **Cron, webhooks, and Gmail Pub/Sub** — automation triggers

**Supported models:** — Any OpenAI, Anthropic, or Ollama compatible endpoint.

## Enterprise Security Configuration

All settings live in `~/.special-agent/special-agent.json` (JSON5 format). Every field is optional — Special Agent uses safe defaults when omitted. Explicit values always override defaults.

Run `special-agent security audit` regularly to check for misconfigurations.

### Tool Profiles

The `tools.profile` setting controls which tools the agent can use. Special Agent defaults to the **coding** profile.

| Profile            | Allowed Tools                              | Config                                |
| ------------------ | ------------------------------------------ | ------------------------------------- |
| `minimal`          | `session_status` only                      | `"tools": { "profile": "minimal" }`   |
| `coding` (default) | File I/O, exec, sessions, memory, image    | `"tools": { "profile": "coding" }`    |
| `messaging`        | Message, session list/history/send, status | `"tools": { "profile": "messaging" }` |
| `full`             | All tools (no restrictions)                | `"tools": { "profile": "full" }`      |

Fine-grained control is available via `tools.allow`, `tools.deny`, and `tools.alsoAllow`.

### Exec Security

Commands run inside a Docker sandbox by default. The exec approval system adds a second layer of control:

| Setting                  | Default                                                     | Description                                                                                 |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `tools.exec.security`    | `"deny"`                                                    | `"deny"` blocks all commands, `"allowlist"` permits approved commands, `"full"` permits all |
| `tools.exec.ask`         | `"on-miss"`                                                 | `"always"` prompts for every command, `"off"` never prompts                                 |
| `tools.exec.askFallback` | `"deny"`                                                    | Fallback when approval prompt is unavailable                                                |
| `tools.exec.host`        | `"sandbox"`                                                 | Where commands run: `"sandbox"`, `"gateway"` (host), or `"node"`                            |
| `tools.exec.safeBins`    | `["jq","grep","cut","sort","uniq","head","tail","tr","wc"]` | Stdin-only binaries that bypass exec approval                                               |
| `tools.exec.timeoutSec`  | (none)                                                      | Auto-kill timeout for commands                                                              |

### Sandbox Configuration

Sandboxed containers run with hardened defaults:

| Setting                       | Default   | Description                                      |
| ----------------------------- | --------- | ------------------------------------------------ |
| `sandbox.docker.readOnlyRoot` | `true`    | Read-only root filesystem                        |
| `sandbox.docker.network`      | `"none"`  | No network access                                |
| `sandbox.docker.capDrop`      | `["ALL"]` | All Linux capabilities dropped                   |
| `sandbox.docker.pidsLimit`    | `256`     | Max processes per container                      |
| `sandbox.docker.memory`       | `"1g"`    | Memory limit                                     |
| `sandbox.docker.memorySwap`   | `"1g"`    | Memory+swap limit (same as memory disables swap) |
| `sandbox.docker.cpus`         | `1`       | CPU limit                                        |
| `sandbox.prune.idleHours`     | `24`      | Prune containers idle for this long              |
| `sandbox.prune.maxAgeDays`    | `7`       | Max container age before pruning                 |

Additional options: `sandbox.docker.image`, `sandbox.docker.user`, `sandbox.docker.seccompProfile`, `sandbox.docker.apparmorProfile`.

### Elevated Exec

Elevated exec allows agents to run commands outside the sandbox on the host machine. **Disabled by default** — requires explicit opt-in:

```json5
{
  tools: {
    elevated: {
      enabled: true,
      allowFrom: {
        telegram: ["+15555550123"],
      },
    },
  },
}
```

Per-agent overrides are available via `agents.list[].tools.elevated`.

### Agent Concurrency

| Setting                                   | Default | Description                        |
| ----------------------------------------- | ------- | ---------------------------------- |
| `agents.defaults.maxConcurrent`           | `2`     | Max concurrent main agent sessions |
| `agents.defaults.subagents.maxConcurrent` | `4`     | Max concurrent sub-agent sessions  |

### Messaging Security

| Setting                                           | Default | Description                                  |
| ------------------------------------------------- | ------- | -------------------------------------------- |
| `tools.message.crossContext.allowWithinProvider`  | `true`  | Cross-channel messaging within same provider |
| `tools.message.crossContext.allowAcrossProviders` | `false` | Cross-channel messaging across providers     |
| `tools.message.broadcast.enabled`                 | `true`  | Broadcast action support                     |

### Channel Access Control

| Setting                           | Default       | Description                                           |
| --------------------------------- | ------------- | ----------------------------------------------------- |
| `channels.<provider>.dmPolicy`    | `"pairing"`   | `"pairing"`, `"allowlist"`, `"open"`, or `"disabled"` |
| `channels.<provider>.groupPolicy` | `"allowlist"` | `"allowlist"`, `"open"`, or `"disabled"`              |
| `channels.<provider>.allowFrom`   | (none)        | Sender allowlist (phone numbers, user IDs)            |

### Plugin Security

| Setting           | Default | Description                                |
| ----------------- | ------- | ------------------------------------------ |
| `plugins.enabled` | `true`  | Set to `false` to disable all plugins      |
| `plugins.allow`   | (none)  | Explicit allowlist of permitted plugin IDs |
| `plugins.deny`    | (none)  | Blocklist of denied plugin IDs             |

### Logging

| Setting                   | Default   | Description                                      |
| ------------------------- | --------- | ------------------------------------------------ |
| `logging.redactSensitive` | `"tools"` | Redacts API keys and secrets in tool output logs |

### Node Command Policy

Dangerous node commands (camera, SMS, screen recording) are blocked by default. Use `gateway.nodes.allowCommands` to permit specific commands and `gateway.nodes.denyCommands` to block additional ones.

### Context and Cost

| Setting                         | Default  | Description                               |
| ------------------------------- | -------- | ----------------------------------------- |
| `agents.defaults.contextTokens` | `128000` | Context window token limit (cost control) |

## Upgrade Notes

**Sandbox pruning defaults restored:** `DEFAULT_SANDBOX_IDLE_HOURS` is `24` and `DEFAULT_SANDBOX_MAX_AGE_DAYS` is `7`. If you previously relied on the shorter values (4 hours / 2 days), set `sandbox.prune.idleHours` and `sandbox.prune.maxAgeDays` explicitly in your config.

**Cross-context messaging default:** `tools.message.crossContext.allowWithinProvider` defaults to `true` (within-provider sends are allowed unless explicitly disabled). To block same-provider cross-channel sends, set `crossContext.allowWithinProvider: false` in your config.

## Install

Requires **Node.js 22+**. Works with npm, pnpm, or bun.

```bash
npm install -g special-agent@latest
special-agent onboard --install-daemon
```

The onboarding wizard guides you through setting up the gateway, workspace, channels, and skills. It also installs the Gateway daemon (launchd/systemd) so it stays running.

Works on **macOS, Linux, and Windows (via WSL2)**.

> **nvm users (Linux):** The Gateway daemon runs as a systemd service with a minimal `PATH` that cannot source your shell profile. nvm does not create a `current` symlink by default, so the service won't find `node`. Create the symlink after installing or switching Node versions:
>
> ```bash
> ln -sf "$NVM_DIR/versions/node/$(node -v)" "$NVM_DIR/current"
> ```
>
> Then reinstall the daemon: `special-agent gateway install --force`

## Quick start

```bash
# Start the gateway
special-agent gateway --port 18789 --verbose

# Send a message
special-agent message send --to +1234567890 --message "Hello from Special Agent"

# Talk to the assistant
special-agent agent --message "Ship checklist" --thinking high
```

## From source

```bash
git clone https://github.com/special-agent/special-agent.git
cd special-agent
pnpm install
pnpm ui:build
pnpm build
pnpm special-agent onboard --install-daemon

# Dev loop (auto-reload on TS changes)
pnpm gateway:watch
```

## How it works

```
Channel plugins (Microsoft Teams, WebChat, custom extensions)
               |
               v
+-------------------------------+
|            Gateway            |
|       (control plane)         |
|     ws://127.0.0.1:18789      |
+---------------+---------------+
               |
               +-- Pi agent (RPC)
               +-- CLI (special-agent ...)
               +-- WebChat UI
               +-- macOS app
               +-- iOS / Android nodes
```

## License

[MIT](LICENSE)
