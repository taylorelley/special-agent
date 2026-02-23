import type { SpecialAgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardFlow } from "../wizard/onboarding.types.js";
import type { WizardPrompter } from "../wizard/prompts.js";

const DEFAULT_PERSONAL_REPO = "~/.special-agent/tasks/personal";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function applyBeadsConfig(
  cfg: SpecialAgentConfig,
  params: {
    enabled: boolean;
    personalRepoPath?: string;
    teamRepoPath?: string;
    actorId?: string;
  },
): SpecialAgentConfig {
  if (!params.enabled) {
    return {
      ...cfg,
      scopes: {
        ...cfg.scopes,
        beads: { enabled: false },
      },
    };
  }

  const pluginConfig: Record<string, unknown> = {
    personalRepoPath: params.personalRepoPath ?? DEFAULT_PERSONAL_REPO,
  };
  if (params.teamRepoPath) {
    pluginConfig.teamRepoPath = params.teamRepoPath;
  }
  if (params.actorId) {
    pluginConfig.actorId = params.actorId;
  }

  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      entries: {
        ...cfg.plugins?.entries,
        "beads-tasks": { enabled: true, config: pluginConfig },
      },
    },
    scopes: {
      ...cfg.scopes,
      beads: {
        enabled: true,
        repos: {
          personal: params.personalRepoPath ?? DEFAULT_PERSONAL_REPO,
          ...(params.teamRepoPath ? { team: params.teamRepoPath } : {}),
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function setupBeads(
  cfg: SpecialAgentConfig,
  _workspaceDir: string,
  _runtime: RuntimeEnv,
  prompter: WizardPrompter,
  flow: WizardFlow,
): Promise<SpecialAgentConfig> {
  const enableBeads = await prompter.confirm({
    message: "Enable Beads task tracking?",
    initialValue: false,
  });

  if (!enableBeads) {
    return applyBeadsConfig(cfg, { enabled: false });
  }

  if (flow === "quickstart") {
    return applyBeadsConfig(cfg, {
      enabled: true,
      personalRepoPath: DEFAULT_PERSONAL_REPO,
    });
  }

  // Advanced flow: prompt for details
  const personalRepoPath = await prompter.text({
    message: "Personal task repo path",
    initialValue: DEFAULT_PERSONAL_REPO,
  });

  let teamRepoPath: string | undefined;
  const configureTeam = await prompter.confirm({
    message: "Configure team backlog?",
    initialValue: false,
  });
  if (configureTeam) {
    teamRepoPath = await prompter.text({
      message: "Team backlog repo path",
      placeholder: "~/team-backlog",
    });
    if (!teamRepoPath.trim()) {
      teamRepoPath = undefined;
    }
  }

  const actorId = await prompter.text({
    message: "Actor ID (your identifier for task claims)",
    placeholder: "agent-alice",
  });

  return applyBeadsConfig(cfg, {
    enabled: true,
    personalRepoPath: personalRepoPath.trim() || DEFAULT_PERSONAL_REPO,
    teamRepoPath: teamRepoPath?.trim() || undefined,
    actorId: actorId.trim() || undefined,
  });
}
