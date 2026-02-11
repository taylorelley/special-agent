---
summary: "CLI reference for `special-agent health` (gateway health endpoint via RPC)"
read_when:
  - You want to quickly check the running Gateway’s health
title: "health"
---

# `special-agent health`

Fetch health from the running Gateway.

```bash
special-agent health
special-agent health --json
special-agent health --verbose
```

Notes:

- `--verbose` runs live probes and prints per-account timings when multiple accounts are configured.
- Output includes per-agent session stores when multiple agents are configured.
