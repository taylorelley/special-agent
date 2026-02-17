---
title: "Microsoft Teams"
description: "Set up the bundled Microsoft Teams channel plugin for Special Agent"
---

# Microsoft Teams

Microsoft Teams is the only bundled messaging channel plugin in Special Agent Enterprise. It uses the Microsoft Bot Framework (`@microsoft/agents-hosting`) to connect the Gateway to Teams conversations.

## Prerequisites

- An Azure subscription with access to create Bot registrations
- A Microsoft Teams tenant where you can install custom apps
- A running Special Agent Gateway

## Quick setup

During onboarding, the wizard prompts for Teams configuration. You can also configure it manually:

```bash
special-agent channels add --channel msteams
```

## Azure Bot registration

### Step 1: Create a Bot in Azure

1. Go to the [Azure Portal](https://portal.azure.com/) > Create a resource > Search "Azure Bot"
2. Create a new Azure Bot resource
3. Select **Multi Tenant** for the bot type
4. Note the **App ID** (also called Client ID)

### Step 2: Get credentials

1. In your Bot resource, go to **Configuration**
2. Copy the **Microsoft App ID**
3. Click **Manage Password** > **New client secret**
4. Copy the **Client Secret** (you won't see it again)

### Step 3: Configure the messaging endpoint

Set the messaging endpoint to your Gateway's webhook URL:

```
https://your-gateway-host.example.com/api/msteams/webhook
```

For local development with tunneling:

```bash
# Using ngrok
ngrok http 18789

# Using Tailscale Funnel
tailscale funnel 18789
```

Set the ngrok/Tailscale URL as the messaging endpoint:
```
https://your-tunnel-url/api/msteams/webhook
```

### Step 4: Enable the Teams channel

In the Azure Bot resource, go to **Channels** > Add **Microsoft Teams**.

## Special Agent configuration

Add the Teams credentials to your config:

```json5
{
  channels: {
    msteams: {
      enabled: true,
      appId: "your-azure-app-id",
      appPassword: "your-client-secret",
      // Optional: webhook path override
      // webhookPath: "/api/msteams/webhook"
    }
  }
}
```

Or set via environment variables:

```bash
export SPECIAL_AGENT_MSTEAMS_APP_ID="your-azure-app-id"
export SPECIAL_AGENT_MSTEAMS_APP_PASSWORD="your-client-secret"
```

## Access control

### DM policy

Control who can send direct messages to the bot:

```json5
{
  channels: {
    msteams: {
      dm: {
        policy: "pairing"  // pairing | allowlist | open | disabled
      }
    }
  }
}
```

### Group policy

Control bot behavior in Teams channels and group chats:

```json5
{
  channels: {
    msteams: {
      groups: {
        policy: "mention"  // mention | all | disabled
        // "mention" = bot responds only when @mentioned
        // "all" = bot responds to every message in allowed groups
      }
    }
  }
}
```

### Allowlists

Restrict which users or groups can interact with the bot:

```json5
{
  channels: {
    msteams: {
      dm: {
        allowlist: ["user-aad-id-1", "user-aad-id-2"]
      },
      groups: {
        allowlist: ["team-id-1", "channel-id-1"]
      }
    }
  }
}
```

## Teams app manifest

Create a Teams app package for installation in your tenant. Minimal manifest:

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
  "manifestVersion": "1.17",
  "id": "your-azure-app-id",
  "version": "1.0.0",
  "name": { "short": "Special Agent", "full": "Special Agent Enterprise" },
  "description": {
    "short": "AI assistant",
    "full": "Enterprise AI assistant powered by Special Agent"
  },
  "developer": {
    "name": "Your Organization",
    "websiteUrl": "https://your-org.example.com",
    "privacyUrl": "https://your-org.example.com/privacy",
    "termsOfUseUrl": "https://your-org.example.com/terms"
  },
  "bots": [
    {
      "botId": "your-azure-app-id",
      "scopes": ["personal", "team", "groupChat"],
      "supportsFiles": true
    }
  ],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": ["your-gateway-host.example.com"]
}
```

Package the manifest as a `.zip` file with the `manifest.json` and app icons, then upload it to your Teams admin center or sideload it for testing.

## Reply style

By default, the bot replies in threads. Configure reply behavior:

```json5
{
  channels: {
    msteams: {
      replyStyle: "thread"  // "thread" | "post"
    }
  }
}
```

## Routing and sessions

- **DMs**: collapsed into a shared `main` session per user (configurable via `dmScope`)
- **Group chats**: isolated session per group
- **Team channels**: isolated session per channel

In multi-agent setups, route Teams conversations to specific agents:

```json5
{
  agents: {
    list: [
      {
        id: "support-agent",
        routing: {
          bindings: [{ channel: "msteams" }]
        }
      }
    ]
  }
}
```

## Capabilities

| Feature | Support |
|---------|---------|
| Text messages | Full |
| Images (inbound) | Full |
| Images (outbound) | Full |
| File attachments | Via Graph API (requires additional permissions) |
| Adaptive Cards | Supported (outbound) |
| Threads | Supported |
| Reactions | Not supported |
| Typing indicators | Supported |

## Troubleshooting

**Bot not responding** — Verify the messaging endpoint URL is correct in Azure and reachable from the internet. Check `special-agent logs` for webhook errors.

**"Unauthorized" errors** — Confirm `appId` and `appPassword` match the Azure Bot registration credentials.

**Messages not appearing** — Ensure the Teams channel is enabled in the Azure Bot resource and the app is installed in your tenant.

**Webhook timeout** — Teams expects a response within 15 seconds. Long agent responses may trigger retries. The plugin handles this with acknowledgement responses.

## Related pages

- [Channels Overview](/channels/overview) — channel architecture and routing
- [WebChat & Control UI](/channels/webchat) — the built-in web interface
- [Security Overview](/security/overview) — DM policies and access control
- [Multi-Agent Routing](/reference/multi-agent) — route Teams to specific agents
