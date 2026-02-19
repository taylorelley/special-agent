import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import path from "node:path";

export { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

// Factory-vs-constructor fallback: pi-coding-agent ≥0.50 exposes AuthStorage.create(),
// while earlier versions only support `new AuthStorage(path)`. This helper tries the
// factory first and falls back to the constructor so both versions work transparently.
type AuthStorageLikeParam = { create: (path: string) => unknown } | { new (path: string): unknown };

export function createAuthStorage(
  AuthStorageLike: AuthStorageLikeParam,
  filePath: string,
): AuthStorage {
  if ("create" in AuthStorageLike && typeof AuthStorageLike.create === "function") {
    const result = AuthStorageLike.create(filePath);
    if (result == null) {
      throw new Error(`AuthStorage.create returned ${result} for path: ${filePath}`);
    }
    return result as AuthStorage;
  }
  if (typeof AuthStorageLike !== "function") {
    throw new Error(`AuthStorageLike is not constructable for path: ${filePath}`);
  }
  return new (AuthStorageLike as { new (path: string): unknown })(filePath) as AuthStorage;
}

// Compatibility helpers for pi-coding-agent 0.50+ (discover* helpers removed).
export function discoverAuthStorage(agentDir: string): AuthStorage {
  return createAuthStorage(AuthStorage, path.join(agentDir, "auth.json"));
}

export function discoverModels(authStorage: AuthStorage, agentDir: string): ModelRegistry {
  return new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
}
