---
title: "WebChat & Control UI"
description: "Built-in web interface for chatting with the agent and managing the Gateway"
---

# WebChat & Control UI

Special Agent includes a built-in web interface served directly by the Gateway. No separate web server is required.

## WebChat

WebChat is a native chat UI that connects to the Gateway over WebSocket. It uses the same sessions and routing as other channels.

### Quick start

```bash
special-agent dashboard
```

Or open `http://127.0.0.1:18789/` directly in your browser.

### How it works

- Connects via the Gateway's WebSocket API on the same port (default 18789)
- Uses `chat.history` to load previous messages, `chat.send` to send new ones
- Sessions follow the same scoping rules as other channels
- If gateway auth is enabled, paste the token in Settings

### Remote access

Access WebChat from a remote machine via SSH tunnel or Tailscale:

```bash
# SSH tunnel
ssh -N -L 18789:127.0.0.1:18789 user@gateway-host
# Then open http://127.0.0.1:18789/ locally
```

```bash
# Tailscale Serve (exposes to your tailnet)
tailscale serve 18789
```

No separate server, domain, or TLS certificate is needed — the Gateway handles everything.

## Control UI

The Control UI is an admin dashboard for managing the Gateway. It provides:

- **Chat interface** — send messages to the agent directly
- **Sessions** — view and manage active sessions
- **Settings** — configure gateway auth, view status
- **Health** — monitor gateway health and diagnostics
- **Logs** — view recent gateway activity

Access the Control UI at the same URL as WebChat (`http://127.0.0.1:18789/`).

### Dashboard URL with token

Generate a dashboard URL with an embedded auth token:

```bash
special-agent dashboard --no-open
```

This prints a URL you can share with team members (the token is in the URL query string).

## Terminal UI (TUI)

For terminal-based access without a browser:

```bash
special-agent tui
```

The TUI provides a chat interface directly in your terminal.

## Configuration

| Setting              | Description                                 | Default    |
| -------------------- | ------------------------------------------- | ---------- |
| `gateway.port`       | Gateway port (WebChat + API)                | `18789`    |
| `gateway.bind`       | Bind address (`loopback`, `lan`, `tailnet`) | `loopback` |
| `gateway.auth.mode`  | Authentication mode (`token`, `password`)   | —          |
| `gateway.auth.token` | Auth token                                  | —          |

## Embedding in internal portals

WebChat can be accessed as an iframe or direct link within internal tools. The Gateway serves all necessary assets. Ensure:

1. The Gateway is accessible from the portal's network
2. Gateway auth token is provided (via URL query or Settings)
3. Content Security Policy allows the Gateway origin if using iframes

## Related pages

- [Microsoft Teams](/channels/microsoft-teams) — the bundled channel plugin
- [Channels Overview](/channels/overview) — channel architecture and routing
- [Configuration](/deployment/configuration) — gateway settings
- [Authentication](/security/authentication) — token and password auth
