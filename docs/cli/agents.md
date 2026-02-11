---
summary: "CLI reference for `special-agent agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `special-agent agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
special-agent agents list
special-agent agents add work --workspace ~/.special-agent/workspace-work
special-agent agents set-identity --workspace ~/.special-agent/workspace --from-identity
special-agent agents set-identity --agent main --avatar avatars/special-agent.png
special-agent agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.special-agent/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
special-agent agents set-identity --workspace ~/.special-agent/workspace --from-identity
```

Override fields explicitly:

```bash
special-agent agents set-identity --agent main --name "Special Agent" --emoji "🦞" --avatar avatars/special-agent.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "Special Agent",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/special-agent.png",
        },
      },
    ],
  },
}
```
