/**
 * Temporarily overrides process.env keys for the duration of `fn`, then restores them.
 * Supports both sync and async callbacks.
 */
export function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void;
export function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void>;
export function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): void | Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  const restore = () => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  };
  let result: void | Promise<void>;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === "function") {
    return result.then(
      () => restore(),
      (err) => {
        restore();
        throw err;
      },
    );
  }
  restore();
}
