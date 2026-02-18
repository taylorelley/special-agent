---
title: "Sandboxing"
description: "Docker-based isolation for agent tool execution"
---

# Sandboxing (Agent Isolation)

Sandboxing runs agent tool execution inside Docker containers, reducing the blast radius of agent actions. The Gateway stays on the host; only tool invocations (exec, read, write, edit, apply_patch) are isolated.

## Modes

| Mode | Behavior |
|------|----------|
| `off` | No sandboxing. Tools run directly on the host. (Default) |
| `non-main` | Non-main sessions run tools in containers. Main sessions run on the host. |
| `all` | All sessions run tools in containers. |

## Scopes

| Scope | Isolation |
|-------|-----------|
| `session` | One container + workspace per session. Maximum isolation. |
| `agent` | One container + workspace per agent. Sessions share the container. (Default when enabled) |
| `shared` | All sessions share one container and workspace. Minimal isolation. |

## Workspace access

| Level | Behavior |
|-------|----------|
| `none` | Sandbox workspace at `~/.special-agent/sandboxes/`. Agent workspace not mounted. (Default) |
| `ro` | Agent workspace mounted read-only at `/agent`. Sandbox workspace at `/workspace`. |
| `rw` | Agent workspace mounted read-write at `/workspace`. |

## Enable sandboxing

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "non-main",       // off | non-main | all
        scope: "agent",         // session | agent | shared
        workspaceAccess: "none" // none | ro | rw
      }
    }
  }
}
```

## Build the sandbox image

```bash
scripts/sandbox-setup.sh
```

This builds `special-agent-sandbox:bookworm-slim` using `Dockerfile.sandbox`.

For a sandbox with common build tooling (Node, Go, Rust):

```bash
scripts/sandbox-common-setup.sh
```

## Docker configuration

Fine-grained control over container resources and security:

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "non-main",
        scope: "agent",
        docker: {
          image: "special-agent-sandbox:bookworm-slim",
          workdir: "/workspace",
          readOnlyRoot: true,
          tmpfs: ["/tmp", "/var/tmp", "/run"],
          network: "none",          // No network access by default
          user: "1000:1000",
          capDrop: ["ALL"],
          env: { LANG: "C.UTF-8" },
          pidsLimit: 256,
          memory: "1g",
          memorySwap: "2g",
          cpus: 1,
          ulimits: {
            nofile: { soft: 1024, hard: 2048 },
            nproc: 256
          },
          seccompProfile: "/path/to/seccomp.json",
          apparmorProfile: "special-agent-sandbox",
          dns: ["1.1.1.1", "8.8.8.8"],
          extraHosts: ["internal.service:10.0.0.5"]
        }
      }
    }
  }
}
```

### Key hardening knobs

| Setting | Default | Purpose |
|---------|---------|---------|
| `network` | `"none"` | No egress. Opt-in for network access. |
| `readOnlyRoot` | `true` | Immutable root filesystem |
| `capDrop` | `["ALL"]` | Drop all Linux capabilities |
| `pidsLimit` | `256` | Limit process count (fork bomb protection) |
| `memory` | `"1g"` | Container memory limit |
| `cpus` | `1` | CPU limit |
| `seccompProfile` | — | Custom seccomp filter |
| `apparmorProfile` | — | AppArmor profile for MAC |

## Tool policy (sandbox tools)

Control which tools are available inside the sandbox:

```json5
{
  tools: {
    sandbox: {
      tools: {
        allow: [
          "exec", "process", "read", "write", "edit",
          "sessions_list", "sessions_history", "sessions_send",
          "sessions_spawn", "session_status"
        ],
        deny: ["browser", "canvas", "nodes", "cron", "gateway"]
      }
    }
  }
}
```

- `deny` wins over `allow`
- Empty `allow` list means all tools are available (minus deny)
- Non-empty `allow` means only listed tools are available (minus deny)

## Per-agent sandbox profiles

In multi-agent setups, override sandbox config per agent:

```json5
{
  agents: {
    list: [
      {
        id: "restricted-agent",
        sandbox: {
          mode: "all",
          scope: "session",
          docker: { network: "none", memory: "512m" }
        },
        tools: {
          sandbox: {
            tools: { allow: ["read", "exec"], deny: ["write", "edit"] }
          }
        }
      }
    ]
  }
}
```

## Browser in sandbox

To run the browser tool inside a sandbox container:

```bash
scripts/sandbox-browser-setup.sh
```

Enable in config:

```json5
{
  agents: {
    defaults: {
      sandbox: {
        browser: { enabled: true }
      }
    }
  }
}
```

Note: The browser runs Chromium with CDP inside the container via Xvfb. Headless mode is available via `browser.headless: true`.

## Container lifecycle

- Containers are created on demand per session/agent
- **Auto-prune**: idle containers removed after 24 hours, or after 7 days max age
- Configure pruning: `sandbox.prune.idleHours` and `sandbox.prune.maxAgeDays`
- Set both to `0` to disable auto-pruning

## Setup commands

Run one-time setup when a container is created:

```json5
{
  agents: {
    defaults: {
      sandbox: {
        docker: {
          setupCommand: "apt-get update && apt-get install -y git curl jq",
          user: "0:0"  // Root required for apt-get
        }
      }
    }
  }
}
```

Note: `readOnlyRoot: true` blocks package installs. Set to `false` if using `setupCommand`.

## Security notes

- Sandbox isolation only applies to **tool execution** (exec, read, write, edit, apply_patch)
- Host-only tools (browser, canvas, nodes, cron) are blocked in sandbox by default
- Adding `browser` to the sandbox allow list runs the browser on the host, **breaking isolation**
- `scope: "shared"` disables cross-session isolation — use with caution

## Related pages

- [Security Overview](/security/overview) — threat model and security checklist
- [Tool Policy & Access Control](/security/tool-policy) — allow/deny lists beyond sandboxing
- [Docker Deployment](/deployment/docker) — containerized gateway setup
