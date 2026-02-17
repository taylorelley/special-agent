---
title: "Channels Overview"
description: "Plugin-based channel architecture and message routing"
---

# Channels Overview

Channels are message transport adapters that connect the Gateway to external messaging platforms. Special Agent Enterprise ships with two channels:

- **Microsoft Teams** — bundled plugin (`@special-agent/msteams`)
- **WebChat** — built-in web UI (not a plugin, embedded in the Gateway)

Additional channels can be added via the plugin system.

## Channel architecture

All channels register with the Gateway at startup via the plugin API (`api.registerChannel()`). The Gateway handles:

- **Inbound delivery** — receive messages from the channel, route to the correct agent/session
- **Outbound delivery** — send agent responses back through the channel
- **Session scoping** — determine which session handles each conversation
- **DM/group policies** — control who can interact with the agent

## Channel routing

When a message arrives, the Gateway resolves it to an agent and session:

1. **Channel** — which platform sent the message (msteams, webchat)
2. **Account** — which bot/app received it (relevant for multi-bot setups)
3. **Peer** — the sender's identity on that platform

In multi-agent setups, routing bindings map these dimensions to specific agents:

```json5
{
  agents: {
    list: [
      {
        id: "support-agent",
        routing: {
          bindings: [
            { channel: "msteams" }  // All Teams messages go to this agent
          ]
        }
      }
    ]
  }
}
```

## DM and group policies

Each channel supports configurable access control:

| Policy | Behavior |
|--------|----------|
| `pairing` | New senders need approval before getting responses |
| `allowlist` | Only pre-approved senders get responses |
| `open` | Anyone can message the agent |
| `disabled` | Channel ignores messages |

Configure per channel:

```json5
{
  channels: {
    msteams: {
      dm: { policy: "pairing" },
      groups: { policy: "mention" }
    }
  }
}
```

## Session scoping

| Conversation type | Default session behavior |
|-------------------|------------------------|
| Direct messages | Shared `main` session per user |
| Group chats | Isolated session per group |
| Team channels | Isolated session per channel |

Override with `dmScope` in agent config to change how DM sessions are scoped.

## Adding custom channels

To add a channel not bundled with Special Agent, build a plugin that calls `api.registerChannel()`. See [Building Custom Channels](/plugins/building-channels) for the plugin API.

Installed channel plugins appear in the onboarding wizard's channel selection step and can be configured like bundled channels.

## Related pages

- [Microsoft Teams](/channels/microsoft-teams) — setup and configuration
- [WebChat & Control UI](/channels/webchat) — built-in web interface
- [Building Custom Channels](/plugins/building-channels) — plugin API for new channels
- [Multi-Agent Routing](/reference/multi-agent) — routing bindings
