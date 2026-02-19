/**
 * Beads Client
 *
 * Manages lifecycle and operations for a single beads task repository.
 * Wraps git operations and JSONL file manipulation for task CRUD.
 *
 * Each beads repo is a git repository containing:
 * - tasks.jsonl: append-only task log
 * - Each line is a task event (created, claimed, updated, completed, etc.)
 */

import type { GitOps, AntiRaceOptions, AntiRaceResult } from "./anti-race.js";
import { withAntiRace, pullLatest } from "./anti-race.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Task status values. */
export type TaskStatus = "open" | "claimed" | "in_progress" | "blocked" | "done" | "cancelled";

/** A beads task entry. */
export type BeadsTask = {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee?: string;
  tags?: string[];
  priority?: "low" | "medium" | "high" | "critical";
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

/** Parameters for creating a task. */
export type CreateTaskParams = {
  title: string;
  description?: string;
  tags?: string[];
  priority?: BeadsTask["priority"];
};

/** Parameters for updating a task. */
export type UpdateTaskParams = {
  status?: TaskStatus;
  title?: string;
  description?: string;
  assignee?: string;
  tags?: string[];
  priority?: BeadsTask["priority"];
};

/** File system operations interface for testing/decoupling. */
export interface FileOps {
  readFile(path: string): Promise<string>;
  appendFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASKS_FILE = "tasks.jsonl";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class BeadsClient {
  constructor(
    private readonly repoPath: string,
    private readonly git: GitOps,
    private readonly fs: FileOps,
    private readonly antiRaceOptions?: AntiRaceOptions,
  ) {}

  /** Full path to the tasks JSONL file. */
  private get tasksPath(): string {
    return `${this.repoPath}/${TASKS_FILE}`;
  }

  /**
   * Initialize the repo directory and tasks file if they don't exist.
   */
  async init(): Promise<void> {
    if (!(await this.fs.exists(this.repoPath))) {
      await this.fs.mkdir(this.repoPath);
    }
    if (!(await this.fs.exists(this.tasksPath))) {
      await this.fs.writeFile(this.tasksPath, "");
    }
  }

  /**
   * List all tasks, pulling latest first.
   * Returns tasks in their most recent state (last event per ID wins).
   */
  async listTasks(): Promise<BeadsTask[]> {
    await pullLatest(this.repoPath, this.git);
    return this.readTasks();
  }

  /**
   * Create a new task with anti-race protection.
   */
  async createTask(params: CreateTaskParams): Promise<AntiRaceResult<BeadsTask>> {
    const now = new Date().toISOString();
    const id = generateTaskId();
    const task: BeadsTask = {
      id,
      title: params.title,
      description: params.description,
      status: "open",
      tags: params.tags,
      priority: params.priority ?? "medium",
      createdAt: now,
      updatedAt: now,
      createdBy: this.antiRaceOptions?.actorId,
    };

    return withAntiRace(
      this.repoPath,
      async () => {
        await this.appendTaskEvent(task);
        return task;
      },
      this.git,
      this.antiRaceOptions,
    );
  }

  /**
   * Claim a task (assign it to the current actor) with anti-race protection.
   */
  async claimTask(taskId: string): Promise<AntiRaceResult<BeadsTask>> {
    return withAntiRace(
      this.repoPath,
      async () => {
        const tasks = await this.readTasks();
        const task = tasks.find((t) => t.id === taskId);
        if (!task) {
          throw new Error(`Task ${taskId} not found`);
        }
        if (task.status !== "open") {
          throw new Error(`Task ${taskId} is not open (status: ${task.status})`);
        }

        const updated: BeadsTask = {
          ...task,
          status: "claimed",
          assignee: this.antiRaceOptions?.actorId,
          updatedAt: new Date().toISOString(),
        };
        await this.appendTaskEvent(updated);
        return updated;
      },
      this.git,
      this.antiRaceOptions,
    );
  }

  /**
   * Update a task with anti-race protection.
   */
  async updateTask(taskId: string, params: UpdateTaskParams): Promise<AntiRaceResult<BeadsTask>> {
    return withAntiRace(
      this.repoPath,
      async () => {
        const tasks = await this.readTasks();
        const task = tasks.find((t) => t.id === taskId);
        if (!task) {
          throw new Error(`Task ${taskId} not found`);
        }

        const updated: BeadsTask = {
          ...task,
          ...stripUndefined(params),
          updatedAt: new Date().toISOString(),
        };
        await this.appendTaskEvent(updated);
        return updated;
      },
      this.git,
      this.antiRaceOptions,
    );
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Read and collapse task events into latest state per task ID. */
  private async readTasks(): Promise<BeadsTask[]> {
    if (!(await this.fs.exists(this.tasksPath))) {
      return [];
    }

    const content = await this.fs.readFile(this.tasksPath);
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    const taskMap = new Map<string, BeadsTask>();

    for (const line of lines) {
      try {
        const task = JSON.parse(line) as BeadsTask;
        taskMap.set(task.id, task);
      } catch {
        // Skip malformed lines
      }
    }

    return Array.from(taskMap.values());
  }

  /** Append a task event to the JSONL file. */
  private async appendTaskEvent(task: BeadsTask): Promise<void> {
    await this.fs.appendFile(this.tasksPath, JSON.stringify(task) + "\n");
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Generate a short random task ID. */
function generateTaskId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `task-${id}`;
}

/** Remove undefined values from an object. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
