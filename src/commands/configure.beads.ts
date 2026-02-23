import type { SpecialAgentConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import { confirm, text } from "./configure.shared.js";
import { applyBeadsConfig } from "./onboard-beads.js";
import { guardCancel } from "./onboard-helpers.js";

const DEFAULT_PERSONAL_REPO = "~/.special-agent/tasks/personal";

export async function promptBeadsConfig(
  nextConfig: SpecialAgentConfig,
  runtime: RuntimeEnv,
): Promise<SpecialAgentConfig> {
  const existingBeads = nextConfig.scopes?.beads;
  const existingPlugin = nextConfig.plugins?.entries?.["beads-tasks"]?.config ?? {};
  const isEnabled =
    existingBeads?.enabled ?? Boolean(nextConfig.plugins?.entries?.["beads-tasks"]?.enabled);

  const enableBeads = guardCancel(
    await confirm({
      message: "Enable Beads task tracking?",
      initialValue: isEnabled,
    }),
    runtime,
  );

  if (!enableBeads) {
    return applyBeadsConfig(nextConfig, { enabled: false });
  }

  const existingPersonal =
    existingBeads?.repos?.personal ??
    (typeof existingPlugin.personalRepoPath === "string"
      ? existingPlugin.personalRepoPath
      : DEFAULT_PERSONAL_REPO);

  const personalRepoPath = guardCancel(
    await text({
      message: "Personal task repo path",
      initialValue: existingPersonal,
    }),
    runtime,
  );

  const existingTeam =
    existingBeads?.repos?.team ??
    (typeof existingPlugin.teamRepoPath === "string" ? existingPlugin.teamRepoPath : undefined);

  let teamRepoPath: string | undefined = existingTeam;
  const configureTeam = guardCancel(
    await confirm({
      message: "Configure team backlog?",
      initialValue: Boolean(existingTeam),
    }),
    runtime,
  );
  if (configureTeam) {
    teamRepoPath = String(
      guardCancel(
        await text({
          message: "Team backlog repo path",
          initialValue: existingTeam ?? "",
          placeholder: "~/team-backlog",
        }),
        runtime,
      ),
    );
    if (!teamRepoPath.trim()) {
      teamRepoPath = undefined;
    }
  } else {
    teamRepoPath = undefined;
  }

  // Project repos
  const existingProjectRepos =
    existingBeads?.projectRepos ??
    (existingPlugin.projectRepos && typeof existingPlugin.projectRepos === "object"
      ? (existingPlugin.projectRepos as Record<string, string>)
      : undefined);

  let projectRepos: Record<string, string> | undefined = existingProjectRepos
    ? { ...existingProjectRepos }
    : undefined;

  if (existingProjectRepos && Object.keys(existingProjectRepos).length > 0) {
    note(
      Object.entries(existingProjectRepos)
        .map(([id, p]) => `${id}: ${p}`)
        .join("\n"),
      "Existing project repos",
    );
  }

  const addProject = guardCancel(
    await confirm({
      message: "Add a project repo?",
      initialValue: false,
    }),
    runtime,
  );

  if (addProject) {
    const projectId = String(
      guardCancel(
        await text({
          message: "Project ID (slug)",
          placeholder: "webapp",
        }),
        runtime,
      ),
    ).trim();

    if (projectId) {
      const projectPath = String(
        guardCancel(
          await text({
            message: `Repo path for "${projectId}"`,
            placeholder: `~/projects/${projectId}/.beads`,
          }),
          runtime,
        ),
      ).trim();

      if (projectPath) {
        projectRepos = { ...projectRepos, [projectId]: projectPath };
      }
    }
  }

  const existingActorId = typeof existingPlugin.actorId === "string" ? existingPlugin.actorId : "";

  const actorId = String(
    guardCancel(
      await text({
        message: "Actor ID (your identifier for task claims)",
        initialValue: existingActorId,
        placeholder: "agent-alice",
      }),
      runtime,
    ),
  ).trim();

  let result = applyBeadsConfig(nextConfig, {
    enabled: true,
    personalRepoPath: String(personalRepoPath).trim() || DEFAULT_PERSONAL_REPO,
    teamRepoPath: teamRepoPath?.trim() || undefined,
    actorId: actorId || undefined,
  });

  // Apply project repos if any
  if (projectRepos && Object.keys(projectRepos).length > 0) {
    const pluginCfg = result.plugins?.entries?.["beads-tasks"]?.config ?? {};
    result = {
      ...result,
      plugins: {
        ...result.plugins,
        entries: {
          ...result.plugins?.entries,
          "beads-tasks": {
            ...result.plugins?.entries?.["beads-tasks"],
            enabled: true,
            config: { ...pluginCfg, projectRepos },
          },
        },
      },
      scopes: {
        ...result.scopes,
        beads: {
          ...result.scopes?.beads,
          projectRepos,
        },
      },
    };
  }

  return result;
}
