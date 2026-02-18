---
title: "Skills Overview"
description: "How skills extend agent capabilities through markdown-based instruction files"
---

# Skills Overview

Skills are the primary extension mechanism in Special Agent. A skill is a directory containing a `SKILL.md` file that teaches the agent how to use tools through natural-language instructions and YAML frontmatter metadata.

Skills require **no code** — just markdown. They are the recommended way to add custom capabilities for enterprise use cases.

## What a skill looks like

```
my-skill/
  SKILL.md      # Required: instructions + frontmatter
  helper.sh     # Optional: scripts the skill references
  templates/    # Optional: any supporting files
```

Minimal `SKILL.md`:

```markdown
---
name: my_custom_skill
description: Does something useful for our team.
---

# My Custom Skill

When the user asks to do X, use the `exec` tool to run:

\`\`\`bash
{baseDir}/helper.sh --input "{input}"
\`\`\`

Return the output to the user.
```

The `{baseDir}` variable resolves to the skill's directory at runtime.

## Locations and precedence

Skills are loaded from four places (highest to lowest precedence):

1. **Workspace skills** — `<workspace>/skills/` (per-agent in multi-agent setups)
2. **Managed skills** — `~/.special-agent/skills/` (shared across agents on the same host)
3. **Bundled skills** — shipped with the Special Agent install
4. **Extra directories** — configured via `skills.load.extraDirs` (lowest precedence)

If a skill name appears in multiple locations, the highest-precedence version wins. This lets you override bundled skills with custom versions.

## Per-agent vs shared skills

In multi-agent setups:

- **Per-agent skills** live in each agent's workspace (`<workspace>/skills/`)
- **Shared skills** live in `~/.special-agent/skills/` and are visible to all agents
- **Extra directories** (`skills.load.extraDirs`) can point to a common skills pack

## Skills vs plugins

|                  | Skills                                                           | Plugins                                                     |
| ---------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| **Format**       | Markdown (`SKILL.md`)                                            | TypeScript/JavaScript                                       |
| **Capabilities** | Teach the agent to use existing tools                            | Register new tools, hooks, channels, services               |
| **Complexity**   | No code required                                                 | Requires code                                               |
| **Use when**     | Adding tool usage patterns, integrating CLIs, defining workflows | Adding new tool types, custom channels, background services |

**Start with skills.** Only build a plugin when you need capabilities skills cannot provide (custom tool types, event hooks, new channels).

## Bundled skills

Special Agent ships with 12 bundled skills. These are loaded by default and can be disabled or overridden:

| Skill           | Description                                          | Requirement                            |
| --------------- | ---------------------------------------------------- | -------------------------------------- |
| `blogwatcher`   | Monitor RSS/Atom feeds                               | `blogwatcher` binary                   |
| `clawhub`       | Skill marketplace CLI                                | `clawhub` binary                       |
| `coding-agent`  | Delegate to coding agents (Claude Code, Codex, etc.) | `claude`, `codex`, `opencode`, or `pi` |
| `github`        | GitHub CLI for issues, PRs, CI                       | `gh` binary                            |
| `healthcheck`   | Host security hardening                              | Built-in                               |
| `mcporter`      | MCP server management                                | `mcporter` binary                      |
| `model-usage`   | Per-model usage summaries                            | `codexbar` (macOS)                     |
| `session-logs`  | Search and analyze session logs                      | `jq`, `rg`                             |
| `skill-creator` | Create and update skills                             | Built-in                               |
| `summarize`     | Summarize URLs, podcasts, files                      | `summarize`                            |
| `tmux`          | Remote-control tmux sessions                         | `tmux`                                 |
| `weather`       | Weather forecasts                                    | `curl`                                 |

Skills with unmet requirements (missing binaries, wrong OS) are automatically filtered out at load time.

## Gating

Skills declare their requirements in frontmatter metadata. The Gateway checks these at load time:

```yaml
---
name: my_db_query
description: Query the internal database
metadata:
  special-agent:
    requires:
      bins: ["psql"] # Required binaries in PATH
      env: ["DATABASE_URL"] # Required environment variables
      config: ["db.host"] # Required config keys
      os: ["linux", "darwin"] # Required OS
---
```

If any requirement is unmet, the skill is silently skipped.

## Configuration

Enable, disable, or configure skills in `~/.special-agent/special-agent.json`:

```json5
{
  skills: {
    load: {
      allowBundled: true, // Load bundled skills (default: true)
      extraDirs: ["/opt/company-skills"], // Additional skill directories
    },
    entries: {
      github: { enabled: true, env: { GITHUB_TOKEN: "ghp_..." } },
      weather: { enabled: false }, // Disable a bundled skill
    },
  },
}
```

## Next steps

- [Creating Your First Skill](/skills/creating-skills) — step-by-step tutorial
- [Skill Frontmatter Reference](/skills/frontmatter-reference) — complete YAML spec
- [Skill Configuration](/skills/configuration) — enable/disable, env injection
- [Bundled Skills Reference](/skills/bundled-skills) — all 12 bundled skills
- [Skill Development Patterns](/skills/development-patterns) — enterprise integration patterns
