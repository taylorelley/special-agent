---
summary: "CLI reference for `special-agent setup` (initialize config + workspace)"
read_when:
  - You’re doing first-run setup without the full onboarding wizard
  - You want to set the default workspace path
title: "setup"
---

# `special-agent setup`

Initialize `~/.special-agent/special-agent.json` and the agent workspace.

Related:

- Getting started: [Getting started](/start/getting-started)
- Wizard: [Onboarding](/start/onboarding)

## Examples

```bash
special-agent setup
special-agent setup --workspace ~/.special-agent/workspace
```

To run the wizard via setup:

```bash
special-agent setup --wizard
```
