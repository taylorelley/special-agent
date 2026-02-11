---
summary: "CLI reference for `special-agent reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `special-agent reset`

Reset local config/state (keeps the CLI installed).

```bash
special-agent reset
special-agent reset --dry-run
special-agent reset --scope config+creds+sessions --yes --non-interactive
```
