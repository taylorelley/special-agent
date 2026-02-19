# Beads Tasks (plugin)

Git-backed distributed task tracking scoped to personal/project/team tiers.
Tasks are stored as append-only JSONL files in git repositories, enabling
offline-capable, conflict-resilient task management across multiple agents.

## Enable

1. Enable the plugin:

```json
{
  "plugins": {
    "entries": {
      "beads-tasks": {
        "enabled": true,
        "config": {
          "personalRepoPath": "~/.special-agent/tasks/personal",
          "teamRepoPath": "~/team-backlog",
          "projectRepos": {
            "webapp": "~/projects/webapp/.beads"
          },
          "actorId": "agent-alice"
        }
      }
    }
  }
}
```

2. Allowlist the tools:

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": { "allow": ["tasks_list", "tasks_create", "tasks_claim", "tasks_update"] }
      }
    ]
  }
}
```

## Commands

| Command  | Description                      |
| -------- | -------------------------------- |
| `/tasks` | List tasks for the current scope |

## Tools

| Tool           | Description                                                   |
| -------------- | ------------------------------------------------------------- |
| `tasks_list`   | List tasks, optionally filtered by status                     |
| `tasks_create` | Create a new task with title, description, priority, tags     |
| `tasks_claim`  | Claim an open task (assign to current agent/user)             |
| `tasks_update` | Update a task's status, title, description, priority, or tags |

## Scope Routing

Tasks are routed to different git repositories based on the active scope:

| Scope    | Default Repo Path                 | Description            |
| -------- | --------------------------------- | ---------------------- |
| Personal | `~/.special-agent/tasks/personal` | Private task list      |
| Project  | Configured per-project            | Project-specific tasks |
| Team     | Configured team repo              | Shared team backlog    |

## Anti-Race Protocol

Task mutations (create, claim, update) use a pull-before-mutate-push protocol
to prevent race conditions in distributed environments:

1. **Pull** latest from remote before reading tasks
2. **Mutate** locally (create/claim/update the task)
3. **Push** the change; if push fails due to conflict, pull-rebase and retry

The protocol retries up to 3 times (configurable) before failing.

## Task Format

Tasks are stored in `tasks.jsonl` files as one JSON object per line:

```json
{
  "id": "task-a1b2c3d4",
  "title": "Fix login bug",
  "status": "open",
  "priority": "high",
  "createdAt": "2026-02-19T00:00:00Z",
  "updatedAt": "2026-02-19T00:00:00Z",
  "createdBy": "agent-alice"
}
```

Each task event is appended. The latest event per task ID represents the
current state (event sourcing pattern).

## Config

| Field              | Type   | Description                               |
| ------------------ | ------ | ----------------------------------------- |
| `personalRepoPath` | string | Path to personal beads repo               |
| `teamRepoPath`     | string | Path to team backlog repo                 |
| `projectRepos`     | object | Map of project ID to beads repo path      |
| `actorId`          | string | Actor identifier for audit trails         |
| `syncIntervalMs`   | number | Git sync interval in ms (default: 300000) |

## Bundled extension note

This extension depends on Special Agent internal modules (`src/scopes/`).
It ships as a bundled extension and is not designed for standalone installation.
