import path from "node:path";

export function normalizeContainerPath(value: string): string {
  let normalized = path.posix.normalize(value);
  if (normalized === ".") {
    return "/";
  }
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function isPathInsideContainerRoot(root: string, target: string): boolean {
  const normalizedRoot = normalizeContainerPath(root);
  const normalizedTarget = normalizeContainerPath(target);
  if (normalizedRoot === "/") {
    return true;
  }
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}
