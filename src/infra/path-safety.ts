import path from "node:path";

/**
 * Resolve a directory path to a safe base directory string for use in
 * `startsWith` checks.  Guarantees a trailing separator so that
 * "/foo/bar".startsWith(resolveSafeBaseDir("/foo/ba")) returns false.
 */
export function resolveSafeBaseDir(dir: string): string {
  const resolved = path.resolve(dir);
  return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
}
