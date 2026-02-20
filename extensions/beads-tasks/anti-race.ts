/**
 * Anti-Race Protocol for Beads Task Operations
 *
 * Implements pull-before-claim, atomic claim, and push-after-claim
 * to prevent race conditions in the distributed git-backed task system.
 *
 * Protocol:
 * 1. Pull latest from remote before reading/claiming tasks.
 * 2. Apply the mutation (create, claim, update) locally.
 * 3. Push the change; if push fails (conflict), pull-rebase and retry.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the anti-race protocol. */
export type AntiRaceOptions = {
  /** Maximum number of push-retry attempts after conflict. */
  maxRetries?: number;
  /** Actor ID for audit trail — threaded into the mutation function. */
  actorId?: string;
};

/** Result of an anti-race operation. */
export type AntiRaceResult<T = void> = {
  ok: boolean;
  retries: number;
  value?: T;
  error?: string;
};

/** Minimal git operations interface for testing/decoupling. */
export interface GitOps {
  pull(repoPath: string): Promise<void>;
  push(repoPath: string): Promise<void>;
  isConflict(error: unknown): boolean;
}

/** A mutation function that applies a change in the repo working tree. */
export type MutationFn<T = void> = (repoPath: string, actorId?: string) => Promise<T>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

/**
 * Execute a mutation with the pull-mutate-push anti-race protocol.
 *
 * @param repoPath - Path to the beads git repo.
 * @param mutate - Function that applies the change in the working tree.
 *   Receives (repoPath, actorId?) — actorId is forwarded from options for audit trail.
 * @param git - Git operations interface.
 * @param options - Protocol options.
 * @returns Result of the operation with retry count.
 */
export async function withAntiRace<T>(
  repoPath: string,
  mutate: MutationFn<T>,
  git: GitOps,
  options?: AntiRaceOptions,
): Promise<AntiRaceResult<T>> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let retries = 0; retries <= maxRetries; retries++) {
    try {
      // Step 1: Pull latest
      await git.pull(repoPath);
    } catch {
      // If pull fails (e.g. no remote, new repo), proceed with local state
    }

    try {
      // Step 2: Apply mutation (actorId forwarded for audit trail)
      const value = await mutate(repoPath, options?.actorId);

      try {
        // Step 3: Push
        await git.push(repoPath);
        return { ok: true, retries, value };
      } catch (pushError) {
        if (git.isConflict(pushError)) {
          continue;
        }
        return {
          ok: false,
          retries,
          error: `Push failed: ${String(pushError)}`,
        };
      }
    } catch (mutateError) {
      return {
        ok: false,
        retries,
        error: `Mutation failed: ${String(mutateError)}`,
      };
    }
  }

  return {
    ok: false,
    retries: maxRetries,
    error: `Exceeded max retries (${maxRetries})`,
  };
}

/**
 * Read-only pull: fetch latest state without mutation.
 * Used before listing tasks to ensure fresh data.
 */
export async function pullLatest(
  repoPath: string,
  git: GitOps,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await git.pull(repoPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
