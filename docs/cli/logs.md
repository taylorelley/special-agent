---
summary: "CLI reference for `special-agent logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `special-agent logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
special-agent logs
special-agent logs --follow
special-agent logs --json
special-agent logs --limit 500
special-agent logs --local-time
special-agent logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.
