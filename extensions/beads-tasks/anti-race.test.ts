import { describe, expect, it } from "vitest";
import type { GitOps, MutationFn } from "./anti-race.js";
import { withAntiRace, pullLatest, DEFAULT_MAX_RETRIES } from "./anti-race.js";

// ---------------------------------------------------------------------------
// Mock git operations
// ---------------------------------------------------------------------------

function makeGit(overrides?: Partial<GitOps>): GitOps {
  return {
    pull: overrides?.pull ?? (async () => {}),
    push: overrides?.push ?? (async () => {}),
    isConflict: overrides?.isConflict ?? (() => false),
  };
}

// ---------------------------------------------------------------------------
// withAntiRace
// ---------------------------------------------------------------------------

describe("withAntiRace", () => {
  it("succeeds on first attempt when no conflicts", async () => {
    const pullCalls: string[] = [];
    const pushCalls: string[] = [];
    const git = makeGit({
      pull: async (path) => {
        pullCalls.push(path);
      },
      push: async (path) => {
        pushCalls.push(path);
      },
    });

    const result = await withAntiRace("/repo", async () => "created", git);

    expect(result.ok).toBe(true);
    expect(result.value).toBe("created");
    expect(result.retries).toBe(0);
    expect(pullCalls).toEqual(["/repo"]);
    expect(pushCalls).toEqual(["/repo"]);
  });

  it("retries on conflict and succeeds", async () => {
    let pushAttempts = 0;
    const git = makeGit({
      push: async () => {
        pushAttempts++;
        if (pushAttempts < 3) {
          throw new Error("non-fast-forward");
        }
      },
      isConflict: (error) => String(error).includes("non-fast-forward"),
    });

    const result = await withAntiRace("/repo", async () => "done", git, { maxRetries: 3 });

    expect(result.ok).toBe(true);
    expect(result.retries).toBe(2);
    expect(pushAttempts).toBe(3);
  });

  it("fails after exhausting retries", async () => {
    const git = makeGit({
      push: async () => {
        throw new Error("rejected");
      },
      isConflict: () => true,
    });

    const result = await withAntiRace("/repo", async () => {}, git, { maxRetries: 2 });

    expect(result.ok).toBe(false);
    expect(result.retries).toBe(2);
    expect(result.error).toContain("Exceeded max retries");
  });

  it("fails immediately on non-conflict push error", async () => {
    const git = makeGit({
      push: async () => {
        throw new Error("auth failed");
      },
      isConflict: () => false,
    });

    const result = await withAntiRace("/repo", async () => "value", git);

    expect(result.ok).toBe(false);
    expect(result.retries).toBe(0);
    expect(result.error).toContain("auth failed");
  });

  it("fails immediately on mutation error", async () => {
    const git = makeGit();
    const mutate: MutationFn = async () => {
      throw new Error("task not found");
    };

    const result = await withAntiRace("/repo", mutate, git);

    expect(result.ok).toBe(false);
    expect(result.retries).toBe(0);
    expect(result.error).toContain("Mutation failed");
    expect(result.error).toContain("task not found");
  });

  it("continues even when pull fails (e.g. no remote)", async () => {
    const git = makeGit({
      pull: async () => {
        throw new Error("no remote");
      },
    });

    const result = await withAntiRace("/repo", async () => "ok", git);

    expect(result.ok).toBe(true);
    expect(result.value).toBe("ok");
  });

  it("passes actorId through to the mutation function", async () => {
    const git = makeGit();
    let capturedActorId: string | undefined;
    const result = await withAntiRace(
      "/repo",
      async (_repoPath, actorId) => {
        capturedActorId = actorId;
        return "created";
      },
      git,
      { actorId: "agent-alice" },
    );

    expect(result.ok).toBe(true);
    expect(capturedActorId).toBe("agent-alice");
  });

  it("exports DEFAULT_MAX_RETRIES", () => {
    expect(DEFAULT_MAX_RETRIES).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// pullLatest
// ---------------------------------------------------------------------------

describe("pullLatest", () => {
  it("returns ok when pull succeeds", async () => {
    const git = makeGit();
    const result = await pullLatest("/repo", git);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns error when pull fails", async () => {
    const git = makeGit({
      pull: async () => {
        throw new Error("network error");
      },
    });
    const result = await pullLatest("/repo", git);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network error");
  });
});
