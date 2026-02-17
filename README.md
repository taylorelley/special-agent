# ✈️ Special Agent ✈️ — Personal AI Assistant

**Special Agent** is a personal AI assistant you run on your own devices. It connects to messaging channels via a plugin-based architecture, provides a built-in WebChat UI, and supports voice interaction on macOS/iOS/Android. The Gateway is the control plane — the product is the assistant.

**Special Agent** is a minimal fork of the OpenClaw project designed for enterprise environments. It provides a controlled baseline with a small, curated set of core skills and plugins.
The project is built to be extended. It is intended to paired with an internally hosted SkillHub, where organizations can create and make available use case–specific skills and plugins.

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
