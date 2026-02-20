import { describe, expect, it, beforeEach } from "vitest";
import type { GitOps } from "./anti-race.js";
import type { FileOps } from "./beads-client.js";
import { BeadsClient } from "./beads-client.js";

// ---------------------------------------------------------------------------
// In-memory mocks
// ---------------------------------------------------------------------------

function makeGit(): GitOps {
  return {
    pull: async () => {},
    push: async () => {},
    isConflict: () => false,
  };
}

function makeFs(): FileOps & { files: Map<string, string>; dirs: Set<string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    readFile: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    appendFile: async (path, content) => {
      const existing = files.get(path) ?? "";
      files.set(path, existing + content);
    },
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    mkdir: async (path) => {
      dirs.add(path);
    },
    exists: async (path) => files.has(path) || dirs.has(path),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BeadsClient", () => {
  let git: GitOps;
  let fs: ReturnType<typeof makeFs>;
  let client: BeadsClient;

  beforeEach(() => {
    git = makeGit();
    fs = makeFs();
    client = new BeadsClient("/repo", git, fs, { actorId: "agent-alice" });
  });

  describe("init", () => {
    it("creates repo directory and tasks file", async () => {
      await client.init();
      expect(fs.dirs.has("/repo")).toBe(true);
      expect(fs.files.has("/repo/tasks.jsonl")).toBe(true);
    });

    it("does not overwrite existing tasks file", async () => {
      fs.files.set("/repo/tasks.jsonl", '{"id":"existing"}\n');
      fs.dirs.add("/repo");
      await client.init();
      expect(fs.files.get("/repo/tasks.jsonl")).toBe('{"id":"existing"}\n');
    });
  });

  describe("listTasks", () => {
    it("returns empty array for new repo", async () => {
      await client.init();
      const tasks = await client.listTasks();
      expect(tasks).toEqual([]);
    });

    it("returns tasks from JSONL file", async () => {
      fs.dirs.add("/repo");
      fs.files.set(
        "/repo/tasks.jsonl",
        '{"id":"t1","title":"Task 1","status":"open","createdAt":"2026-01-01","updatedAt":"2026-01-01"}\n' +
          '{"id":"t2","title":"Task 2","status":"done","createdAt":"2026-01-02","updatedAt":"2026-01-02"}\n',
      );
      const tasks = await client.listTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe("t1");
      expect(tasks[1].id).toBe("t2");
    });

    it("collapses events: last event per ID wins", async () => {
      fs.dirs.add("/repo");
      fs.files.set(
        "/repo/tasks.jsonl",
        '{"id":"t1","title":"Task 1","status":"open","createdAt":"2026-01-01","updatedAt":"2026-01-01"}\n' +
          '{"id":"t1","title":"Task 1","status":"claimed","assignee":"bob","createdAt":"2026-01-01","updatedAt":"2026-01-02"}\n',
      );
      const tasks = await client.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe("claimed");
      expect(tasks[0].assignee).toBe("bob");
    });

    it("skips malformed JSONL lines", async () => {
      fs.dirs.add("/repo");
      fs.files.set(
        "/repo/tasks.jsonl",
        '{"id":"t1","title":"Good","status":"open","createdAt":"2026-01-01","updatedAt":"2026-01-01"}\n' +
          "not json\n" +
          '{"id":"t2","title":"Also good","status":"open","createdAt":"2026-01-01","updatedAt":"2026-01-01"}\n',
      );
      const tasks = await client.listTasks();
      expect(tasks).toHaveLength(2);
    });
  });

  describe("createTask", () => {
    it("creates a task and returns it", async () => {
      await client.init();
      const result = await client.createTask({ title: "Build feature" });
      expect(result.ok).toBe(true);
      expect(result.value).toBeDefined();
      expect(result.value!.title).toBe("Build feature");
      expect(result.value!.status).toBe("open");
      expect(result.value!.createdBy).toBe("agent-alice");
      expect(result.value!.id).toMatch(/^task-[a-z0-9]{8}$/);
    });

    it("appends task to JSONL file", async () => {
      await client.init();
      await client.createTask({ title: "Task A" });
      await client.createTask({ title: "Task B" });
      const content = fs.files.get("/repo/tasks.jsonl")!;
      const lines = content.split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
    });

    it("sets priority and tags", async () => {
      await client.init();
      const result = await client.createTask({
        title: "Urgent bug",
        priority: "critical",
        tags: ["bug", "production"],
      });
      expect(result.value!.priority).toBe("critical");
      expect(result.value!.tags).toEqual(["bug", "production"]);
    });
  });

  describe("claimTask", () => {
    it("claims an open task", async () => {
      await client.init();
      const created = await client.createTask({ title: "Build it" });
      const taskId = created.value!.id;

      const result = await client.claimTask(taskId);
      expect(result.ok).toBe(true);
      expect(result.value!.status).toBe("claimed");
      expect(result.value!.assignee).toBe("agent-alice");
    });

    it("fails to claim a non-existent task", async () => {
      await client.init();
      const result = await client.claimTask("nonexistent");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("fails to claim an already claimed task", async () => {
      await client.init();
      const created = await client.createTask({ title: "Build it" });
      const taskId = created.value!.id;

      await client.claimTask(taskId);
      const secondClaim = await client.claimTask(taskId);
      expect(secondClaim.ok).toBe(false);
      expect(secondClaim.error).toContain("not open");
    });
  });

  describe("updateTask", () => {
    it("updates task status", async () => {
      await client.init();
      const created = await client.createTask({ title: "Build it" });
      const taskId = created.value!.id;

      const result = await client.updateTask(taskId, { status: "in_progress" });
      expect(result.ok).toBe(true);
      expect(result.value!.status).toBe("in_progress");
    });

    it("updates task title and description", async () => {
      await client.init();
      const created = await client.createTask({ title: "Old title" });
      const taskId = created.value!.id;

      const result = await client.updateTask(taskId, {
        title: "New title",
        description: "Added details",
      });
      expect(result.ok).toBe(true);
      expect(result.value!.title).toBe("New title");
      expect(result.value!.description).toBe("Added details");
    });

    it("fails to update a non-existent task", async () => {
      await client.init();
      const result = await client.updateTask("nonexistent", { status: "done" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not found");
    });
  });
});
