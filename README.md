# ✈️ Special Agent — Personal AI Assistant

<p align="center">
    <picture>
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/special-agent/special-agent/main/docs/assets/special-agent-logo-text-dark.png">
        <img src="https://raw.githubusercontent.com/special-agent/special-agent/main/docs/assets/special-agent-logo-text.png" alt="Special Agent" width="500">
    </picture>
</p>

<p align="center">
  <a href="https://github.com/special-agent/special-agent/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/special-agent/special-agent/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/special-agent/special-agent/releases"><img src="https://img.shields.io/github/v/release/special-agent/special-agent?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="https://discord.gg/clawd"><img src="https://img.shields.io/discord/1456350064065904867?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**Special Agent** is a personal AI assistant you run on your own devices. It connects to messaging channels via a plugin-based architecture, provides a built-in WebChat UI, and supports voice interaction on macOS/iOS/Android. The Gateway is the control plane — the product is the assistant.

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

**Supported model APIs:** [Anthropic](https://www.anthropic.com/) (Claude), [OpenAI](https://openai.com/) (GPT), [Google](https://ai.google.dev/) (Gemini)

## Install

Requires **Node.js 22+**. Works with npm, pnpm, or bun.

```bash
npm install -g special-agent@latest
special-agent onboard --install-daemon
```

The onboarding wizard guides you through setting up the gateway, workspace, channels, and skills. It also installs the Gateway daemon (launchd/systemd) so it stays running.

Works on **macOS, Linux, and Windows (via WSL2)**.

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

## Documentation

Full documentation is available at **[docs.openclaw.ai](https://docs.openclaw.ai)**.

| Topic | Link |
|-------|------|
| Getting started | [docs.openclaw.ai/start/getting-started](https://docs.openclaw.ai/start/getting-started) |
| Architecture | [docs.openclaw.ai/concepts/architecture](https://docs.openclaw.ai/concepts/architecture) |
| Configuration | [docs.openclaw.ai/gateway/configuration](https://docs.openclaw.ai/gateway/configuration) |
| Channels | [docs.openclaw.ai/channels](https://docs.openclaw.ai/channels) |
| Security | [docs.openclaw.ai/gateway/security](https://docs.openclaw.ai/gateway/security) |
| Skills | [docs.openclaw.ai/tools/skills](https://docs.openclaw.ai/tools/skills) |
| Troubleshooting | [docs.openclaw.ai/channels/troubleshooting](https://docs.openclaw.ai/channels/troubleshooting) |
| FAQ | [docs.openclaw.ai/start/faq](https://docs.openclaw.ai/start/faq) |

**Platform guides:** [macOS](https://docs.openclaw.ai/platforms/macos) · [Linux](https://docs.openclaw.ai/platforms/linux) · [Windows (WSL2)](https://docs.openclaw.ai/platforms/windows) · [iOS](https://docs.openclaw.ai/platforms/ios) · [Android](https://docs.openclaw.ai/platforms/android) · [Docker](https://docs.openclaw.ai/install/docker) · [Nix](https://github.com/special-agent/nix-special-agent)

Upgrading? See the [updating guide](https://docs.openclaw.ai/install/updating) and run `special-agent doctor`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines and how to submit PRs.

## Community

- [Discord](https://discord.gg/clawd)
- [Website](https://openclaw.ai)
- [DeepWiki](https://deepwiki.com/special-agent/special-agent)

## License

[MIT](LICENSE) — Copyright 2025 Peter Steinberger
