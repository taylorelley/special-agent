---
summary: "Uninstall Special Agent completely (CLI, service, state, workspace)"
read_when:
  - You want to remove Special Agent from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `special-agent` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
special-agent uninstall
```

Non-interactive (automation / npx):

```bash
special-agent uninstall --all --yes --non-interactive
npx -y special-agent uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
special-agent gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
special-agent gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${SPECIAL_AGENT_STATE_DIR:-$HOME/.special-agent}"
```

If you set `SPECIAL_AGENT_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.special-agent/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g special-agent
pnpm remove -g special-agent
bun remove -g special-agent
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/SpecialAgent.app
```

Notes:

- If you used profiles (`--profile` / `SPECIAL_AGENT_PROFILE`), repeat step 3 for each state dir (defaults are `~/.special-agent-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `special-agent` is missing.

### macOS (launchd)

Default label is `bot.molt.gateway` (or `bot.molt.<profile>`; legacy `com.special-agent.*` may still exist):

```bash
launchctl bootout gui/$UID/bot.molt.gateway
rm -f ~/Library/LaunchAgents/bot.molt.gateway.plist
```

If you used a profile, replace the label and plist name with `bot.molt.<profile>`. Remove any legacy `com.special-agent.*` plists if present.

### Linux (systemd user unit)

Default unit name is `special-agent-gateway.service` (or `special-agent-gateway-<profile>.service`):

```bash
systemctl --user disable --now special-agent-gateway.service
rm -f ~/.config/systemd/user/special-agent-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `Special Agent Gateway` (or `Special Agent Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "Special Agent Gateway"
Remove-Item -Force "$env:USERPROFILE\.special-agent\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.special-agent-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://openclaw.ai/install.sh` or `install.ps1`, the CLI was installed with `npm install -g special-agent@latest`.
Remove it with `npm rm -g special-agent` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `special-agent ...` / `bun run special-agent ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
