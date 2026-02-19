/**
 * Beads Tasks Extension
 *
 * Git-backed distributed task tracking scoped to personal/project/team tiers.
 * Registers tools (tasks_list, tasks_create, tasks_claim, tasks_update) and
 * the /tasks command for interacting with scoped task repositories.
 */

import type { AnyAgentTool, SpecialAgentPluginApi } from "special-agent/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { readFile, appendFile, writeFile, mkdir, access } from "node:fs/promises";
import type { ScopeContext } from "../../src/scopes/types.js";
import type { GitOps } from "./anti-race.js";
import type { FileOps, BeadsTask } from "./beads-client.js";
import type { BeadsPluginConfig, ResolvedRepoPath } from "./scope-routing.js";
import { resolveScopeContext } from "../../src/scopes/resolver.js";
import { BeadsClient } from "./beads-client.js";
import { resolveRepoPath, resolveBeadsConfig, listConfiguredRepos } from "./scope-routing.js";

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

const defaultFileOps: FileOps = {
  readFile: (path) => readFile(path, "utf-8"),
  appendFile: (path, content) => appendFile(path, content, "utf-8"),
  writeFile: (path, content) => writeFile(path, content, "utf-8"),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => {}),
  exists: (path) =>
    access(path)
      .then(() => true)
      .catch(() => false),
};

const defaultGitOps: GitOps = {
  async pull(repoPath) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    await exec("git", ["-C", repoPath, "pull", "--rebase", "--quiet"]);
  },
  async push(repoPath) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    await exec("git", ["-C", repoPath, "add", "."]);
    await exec("git", ["-C", repoPath, "commit", "-m", "beads: task update", "--allow-empty"]);
    await exec("git", ["-C", repoPath, "push", "--quiet"]);
  },
  isConflict(error) {
    const msg = String(error);
    return msg.includes("conflict") || msg.includes("non-fast-forward") || msg.includes("rejected");
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClientForScope(
  scope: ScopeContext,
  config: BeadsPluginConfig,
  git: GitOps,
  fs: FileOps,
): { client: BeadsClient; resolved: ResolvedRepoPath } | undefined {
  const resolved = resolveRepoPath(scope, config);
  if (!resolved) return undefined;

  const client = new BeadsClient(resolved.path, git, fs, {
    actorId: config.actorId,
  });
  return { client, resolved };
}

function formatTaskList(tasks: BeadsTask[], label: string): string {
  if (tasks.length === 0) {
    return `No tasks in **${label}**.`;
  }

  const lines = [`**${label}** (${tasks.length} task${tasks.length === 1 ? "" : "s"}):\n`];
  for (const task of tasks) {
    const status = statusEmoji(task.status);
    const assignee = task.assignee ? ` → ${task.assignee}` : "";
    const priority = task.priority ? ` [${task.priority}]` : "";
    lines.push(`${status} \`${task.id}\` ${task.title}${priority}${assignee}`);
  }
  return lines.join("\n");
}

function statusEmoji(status: string): string {
  switch (status) {
    case "open":
      return "○";
    case "claimed":
    case "in_progress":
      return "◑";
    case "done":
      return "●";
    case "blocked":
      return "✕";
    case "cancelled":
      return "—";
    default:
      return "?";
  }
}

function resolveScope(sessionKey: string | undefined, config: BeadsPluginConfig): ScopeContext {
  if (sessionKey) {
    return resolveScopeContext({ sessionKey });
  }
  return {
    tier: "personal",
    userId: config.actorId ?? "unknown",
    isGroupSession: false,
  };
}

function jsonToolResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function errorToolResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { error: message },
  };
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export default function register(api: SpecialAgentPluginApi) {
  const logger = api.logger;
  const config = resolveBeadsConfig(api.pluginConfig);

  const repos = listConfiguredRepos(config);
  if (repos.length === 0) {
    logger.info("beads-tasks: no repos configured, skipping activation");
    return;
  }

  logger.info(`beads-tasks: ${repos.length} repo(s) configured`);

  // -----------------------------------------------------------------------
  // /tasks command — list tasks for current scope
  // -----------------------------------------------------------------------
  api.registerCommand({
    name: "tasks",
    description: "List tasks for the current scope (/tasks [scope])",
    acceptsArgs: true,
    async handler(ctx) {
      const scope = resolveScope(ctx.sessionKey, config);

      const target = getClientForScope(scope, config, defaultGitOps, defaultFileOps);
      if (!target) {
        return { text: `No beads repo configured for scope **${scope.tier}**.` };
      }

      try {
        await target.client.init();
        const tasks = await target.client.listTasks();
        return { text: formatTaskList(tasks, target.resolved.label) };
      } catch (error) {
        return { text: `Failed to list tasks: ${String(error)}` };
      }
    },
  });

  // -----------------------------------------------------------------------
  // Tool: tasks_list
  // -----------------------------------------------------------------------
  const tasksListTool = {
    name: "tasks_list",
    label: "Tasks List",
    description: "List tasks from the current scope's beads repository",
    parameters: Type.Object({
      status: Type.Optional(
        Type.String({
          description: "Filter by status (open, claimed, in_progress, done, blocked, cancelled)",
        }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const scope: ScopeContext = {
        tier: "personal",
        userId: config.actorId ?? "unknown",
        isGroupSession: false,
      };

      const target = getClientForScope(scope, config, defaultGitOps, defaultFileOps);
      if (!target) {
        return errorToolResult(`No beads repo for scope "${scope.tier}"`);
      }

      try {
        await target.client.init();
        let tasks = await target.client.listTasks();
        if (typeof params.status === "string") {
          tasks = tasks.filter((t) => t.status === params.status);
        }
        return jsonToolResult({ scope: target.resolved.label, tasks });
      } catch (error) {
        return errorToolResult(String(error));
      }
    },
  };

  // -----------------------------------------------------------------------
  // Tool: tasks_create
  // -----------------------------------------------------------------------
  const tasksCreateTool = {
    name: "tasks_create",
    label: "Tasks Create",
    description: "Create a new task in the current scope's beads repository",
    parameters: Type.Object({
      title: Type.String({ description: "Task title" }),
      description: Type.Optional(Type.String({ description: "Task description" })),
      priority: Type.Optional(
        Type.String({
          description: "Task priority (low, medium, high, critical)",
        }),
      ),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Task tags" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const scope: ScopeContext = {
        tier: "personal",
        userId: config.actorId ?? "unknown",
        isGroupSession: false,
      };

      const target = getClientForScope(scope, config, defaultGitOps, defaultFileOps);
      if (!target) {
        return errorToolResult(`No beads repo for scope "${scope.tier}"`);
      }

      try {
        await target.client.init();
        const title = typeof params.title === "string" ? params.title : "";
        const description = typeof params.description === "string" ? params.description : undefined;
        const priority = typeof params.priority === "string" ? params.priority : undefined;
        const tags = Array.isArray(params.tags) ? params.tags : undefined;
        const result = await target.client.createTask({
          title,
          description,
          priority: priority as "low" | "medium" | "high" | "critical" | undefined,
          tags,
        });
        if (!result.ok) {
          return errorToolResult(result.error ?? "Unknown error");
        }
        return jsonToolResult({ scope: target.resolved.label, task: result.value });
      } catch (error) {
        return errorToolResult(String(error));
      }
    },
  };

  // -----------------------------------------------------------------------
  // Tool: tasks_claim
  // -----------------------------------------------------------------------
  const tasksClaimTool = {
    name: "tasks_claim",
    label: "Tasks Claim",
    description: "Claim an open task (assign it to the current agent/user)",
    parameters: Type.Object({
      taskId: Type.String({ description: "The task ID to claim" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const scope: ScopeContext = {
        tier: "personal",
        userId: config.actorId ?? "unknown",
        isGroupSession: false,
      };

      const target = getClientForScope(scope, config, defaultGitOps, defaultFileOps);
      if (!target) {
        return errorToolResult(`No beads repo for scope "${scope.tier}"`);
      }

      try {
        await target.client.init();
        const taskId = typeof params.taskId === "string" ? params.taskId : "";
        const result = await target.client.claimTask(taskId);
        if (!result.ok) {
          return errorToolResult(result.error ?? "Unknown error");
        }
        return jsonToolResult({ scope: target.resolved.label, task: result.value });
      } catch (error) {
        return errorToolResult(String(error));
      }
    },
  };

  // -----------------------------------------------------------------------
  // Tool: tasks_update
  // -----------------------------------------------------------------------
  const tasksUpdateTool = {
    name: "tasks_update",
    label: "Tasks Update",
    description: "Update a task's status, title, description, or other fields",
    parameters: Type.Object({
      taskId: Type.String({ description: "The task ID to update" }),
      status: Type.Optional(
        Type.String({
          description: "New status (open, claimed, in_progress, blocked, done, cancelled)",
        }),
      ),
      title: Type.Optional(Type.String({ description: "Updated title" })),
      description: Type.Optional(Type.String({ description: "Updated description" })),
      priority: Type.Optional(
        Type.String({
          description: "Updated priority (low, medium, high, critical)",
        }),
      ),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Updated tags" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const scope: ScopeContext = {
        tier: "personal",
        userId: config.actorId ?? "unknown",
        isGroupSession: false,
      };

      const target = getClientForScope(scope, config, defaultGitOps, defaultFileOps);
      if (!target) {
        return errorToolResult(`No beads repo for scope "${scope.tier}"`);
      }

      try {
        await target.client.init();
        const taskId = typeof params.taskId === "string" ? params.taskId : "";
        const updates: Record<string, unknown> = {};
        if (typeof params.status === "string") updates.status = params.status;
        if (typeof params.title === "string") updates.title = params.title;
        if (typeof params.description === "string") updates.description = params.description;
        if (typeof params.priority === "string") updates.priority = params.priority;
        if (Array.isArray(params.tags)) updates.tags = params.tags;
        const result = await target.client.updateTask(taskId, updates);
        if (!result.ok) {
          return errorToolResult(result.error ?? "Unknown error");
        }
        return jsonToolResult({ scope: target.resolved.label, task: result.value });
      } catch (error) {
        return errorToolResult(String(error));
      }
    },
  };

  api.registerTool(tasksListTool as unknown as AnyAgentTool, { optional: true });
  api.registerTool(tasksCreateTool as unknown as AnyAgentTool, { optional: true });
  api.registerTool(tasksClaimTool as unknown as AnyAgentTool, { optional: true });
  api.registerTool(tasksUpdateTool as unknown as AnyAgentTool, { optional: true });

  logger.info(
    "beads-tasks: registered tools (tasks_list, tasks_create, tasks_claim, tasks_update) and /tasks command",
  );
}
