---
summary: "CLI reference for `special-agent voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
title: "voicecall"
---

# `special-agent voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:

- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
special-agent voicecall status --call-id <id>
special-agent voicecall call --to "+15555550123" --message "Hello" --mode notify
special-agent voicecall continue --call-id <id> --message "Any questions?"
special-agent voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
special-agent voicecall expose --mode serve
special-agent voicecall expose --mode funnel
special-agent voicecall unexpose
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.
