---
summary: "CLI reference for `special-agent tui` (terminal UI connected to the Gateway)"
read_when:
  - You want a terminal UI for the Gateway (remote-friendly)
  - You want to pass url/token/session from scripts
title: "tui"
---

# `special-agent tui`

Open the terminal UI connected to the Gateway.

Related:

- TUI guide: [TUI](/web/tui)

## Examples

```bash
special-agent tui
special-agent tui --url ws://127.0.0.1:18789 --token <token>
special-agent tui --session main --deliver
```
