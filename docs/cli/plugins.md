---
summary: "CLI reference for `special-agent plugins` (list, install, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
title: "plugins"
---

# `special-agent plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:

- Plugin system: [Plugins](/tools/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
special-agent plugins list
special-agent plugins info <id>
special-agent plugins enable <id>
special-agent plugins disable <id>
special-agent plugins doctor
special-agent plugins update <id>
special-agent plugins update --all
```

Bundled plugins ship with Special Agent but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `special-agent.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
special-agent plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
special-agent plugins install -l ./my-plugin
```

### Update

```bash
special-agent plugins update <id>
special-agent plugins update --all
special-agent plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
