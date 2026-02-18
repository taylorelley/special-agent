---
title: "Authentication & Authorization"
description: "Gateway auth modes, model provider credentials, and access control"
---

# Authentication & Authorization

## Gateway authentication

The Gateway supports two authentication modes, configured during onboarding or via config:

### Token authentication (recommended)

A shared secret token required for all WebSocket and HTTP connections.

```json5
{
  gateway: {
    auth: {
      mode: "token",
      token: "your-secret-token-here",
    },
  },
}
```

Set via environment variable:

```bash
export SPECIAL_AGENT_GATEWAY_TOKEN="your-secret-token-here"
```

Clients include the token in the WebSocket `connect` frame: `connect.params.auth.token`.

### Password authentication

Username/password authentication for the Control UI and WebSocket connections.

```json5
{
  gateway: {
    auth: {
      mode: "password",
      password: "your-password-here",
    },
  },
}
```

### No authentication

If no auth is configured, anyone who can reach the Gateway port can interact with the agent. This is only acceptable when the Gateway is bound to loopback (`127.0.0.1`) and not exposed to the network.

## Device pairing

WebSocket clients include a device identity on `connect`. New device IDs require pairing approval. The Gateway issues a device token for subsequent connections.

- **Local connections** (loopback or gateway host's own tailnet address) can be auto-approved
- **Non-local connections** must sign the `connect.challenge` nonce and require explicit approval

Manage devices:

```bash
special-agent devices list
special-agent devices approve <requestId>
```

## Model provider authentication

The onboarding wizard configures model provider credentials:

### Custom Provider (OpenAI/Anthropic-compatible)

```json5
{
  models: {
    providers: {
      "my-provider": {
        type: "openai", // or "anthropic"
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-...",
      },
    },
  },
}
```

### Ollama

```json5
{
  models: {
    providers: {
      ollama: {
        type: "openai",
        baseUrl: "http://localhost:11434/v1",
      },
    },
  },
}
```

### Auth profiles

For managing multiple credentials or rotating keys:

```bash
# Check current auth status
special-agent models auth-status

# Set an API key
special-agent configure set models.providers.my-provider.apiKey "sk-new-key"
```

### Per-agent and per-session credentials

In multi-agent setups, different agents can use different model providers:

```json5
{
  agents: {
    list: [
      {
        id: "team-a",
        model: { provider: "provider-a" },
      },
      {
        id: "team-b",
        model: { provider: "provider-b" },
      },
    ],
  },
}
```

## Reverse proxy configuration

When running behind a reverse proxy (nginx, Caddy, etc.), configure trusted proxies so the Gateway correctly identifies client IPs:

```json5
{
  gateway: {
    trustedProxies: ["10.0.0.0/8", "172.16.0.0/12"],
  },
}
```

Important: Without trusted proxy configuration, the Gateway may treat all connections as local, bypassing pairing requirements.

## Control UI over HTTP

The Control UI uses WebSocket for real-time communication. When served over plain HTTP (not HTTPS), browsers restrict certain features. For production deployments, terminate TLS at your reverse proxy.

## Troubleshooting

**"No credentials found"** — No model provider API key is configured. Run `special-agent models auth-status` to check, then set a key via config or environment variable.

**"unauthorized" or "disconnected (1008)"** — Gateway token is missing or incorrect. Verify the token matches between client and Gateway config.

**"pairing required"** — A new device is connecting. Approve it with `special-agent devices approve <requestId>`.

## Related pages

- [Security Overview](/security/overview) — threat model and security checklist
- [Network Security](/security/network) — bind modes, Tailscale, TLS
- [Model Providers](/reference/model-providers) — provider configuration details
