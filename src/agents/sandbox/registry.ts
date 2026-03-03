import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { acquireSessionWriteLock } from "../session-write-lock.js";
import { SANDBOX_BROWSER_REGISTRY_PATH, SANDBOX_REGISTRY_PATH } from "./constants.js";

export type SandboxRegistryEntry = {
  containerName: string;
  sessionKey: string;
  createdAtMs: number;
  lastUsedAtMs: number;
  image: string;
  configHash?: string;
};

type SandboxRegistry = {
  entries: SandboxRegistryEntry[];
};

export type SandboxBrowserRegistryEntry = {
  containerName: string;
  sessionKey: string;
  createdAtMs: number;
  lastUsedAtMs: number;
  image: string;
  configHash?: string;
  cdpPort: number;
  noVncPort?: number;
};

type SandboxBrowserRegistry = {
  entries: SandboxBrowserRegistryEntry[];
};

type RegistryReadMode = "strict" | "fallback";

type RegistryEntry = {
  containerName: string;
};

type RegistryFile<T extends RegistryEntry> = {
  entries: T[];
};

type UpsertEntry = RegistryEntry & {
  createdAtMs: number;
  image: string;
  configHash?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isRegistryEntry(value: unknown): value is RegistryEntry {
  return (
    isRecord(value) && typeof value.containerName === "string" && value.containerName.length > 0
  );
}

function isSandboxRegistryEntry(value: unknown): value is SandboxRegistryEntry {
  return (
    isRegistryEntry(value) &&
    typeof (value as Record<string, unknown>).sessionKey === "string" &&
    typeof (value as Record<string, unknown>).lastUsedAtMs === "number" &&
    typeof (value as Record<string, unknown>).createdAtMs === "number" &&
    typeof (value as Record<string, unknown>).image === "string"
  );
}

function isBrowserRegistryEntry(value: unknown): value is SandboxBrowserRegistryEntry {
  return (
    isSandboxRegistryEntry(value) && typeof (value as Record<string, unknown>).cdpPort === "number"
  );
}

function isRegistryFile<T extends RegistryEntry>(
  value: unknown,
  entryGuard: (v: unknown) => v is T = isRegistryEntry as (v: unknown) => v is T,
): value is RegistryFile<T> {
  if (!isRecord(value)) {
    return false;
  }

  const maybeEntries = value.entries;
  return Array.isArray(maybeEntries) && maybeEntries.every(entryGuard);
}

async function withRegistryLock<T>(registryPath: string, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireSessionWriteLock({ sessionFile: registryPath });
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

async function readRegistryFromFile<T extends RegistryEntry>(
  registryPath: string,
  mode: RegistryReadMode,
  entryGuard?: (v: unknown) => v is T,
): Promise<RegistryFile<T>> {
  try {
    const raw = await fs.readFile(registryPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRegistryFile<T>(parsed, entryGuard)) {
      return parsed;
    }
    if (mode === "fallback") {
      return { entries: [] };
    }
    throw new Error(`Invalid sandbox registry format: ${registryPath}`);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      return { entries: [] };
    }
    if (mode === "fallback" && (error instanceof SyntaxError || code === "EACCES")) {
      return { entries: [] };
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to read sandbox registry file: ${registryPath}`, { cause: error });
  }
}

async function writeRegistryFile<T extends RegistryEntry>(
  registryPath: string,
  registry: RegistryFile<T>,
): Promise<void> {
  const registryDir = path.dirname(registryPath);
  await fs.mkdir(registryDir, { recursive: true });
  const payload = `${JSON.stringify(registry, null, 2)}\n`;
  const tempPath = path.join(
    registryDir,
    `${path.basename(registryPath)}.${crypto.randomUUID()}.tmp`,
  );
  await fs.writeFile(tempPath, payload, "utf-8");
  try {
    await fs.rename(tempPath, registryPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

export async function readRegistry(): Promise<SandboxRegistry> {
  return await readRegistryFromFile<SandboxRegistryEntry>(
    SANDBOX_REGISTRY_PATH,
    "fallback",
    isSandboxRegistryEntry,
  );
}

function upsertEntry<T extends UpsertEntry>(entries: T[], entry: T): T[] {
  const existing = entries.find((item) => item.containerName === entry.containerName);
  const next = entries.filter((item) => item.containerName !== entry.containerName);
  next.push({
    ...entry,
    createdAtMs: existing?.createdAtMs ?? entry.createdAtMs,
    image: existing?.image ?? entry.image,
    configHash: entry.configHash ?? existing?.configHash,
  });
  return next;
}

function removeEntry<T extends RegistryEntry>(entries: T[], containerName: string): T[] {
  return entries.filter((entry) => entry.containerName !== containerName);
}

async function withRegistryMutation<T extends RegistryEntry>(
  registryPath: string,
  mutate: (entries: T[]) => T[] | null,
): Promise<void> {
  await withRegistryLock(registryPath, async () => {
    const registry = await readRegistryFromFile<T>(registryPath, "strict");
    const next = mutate(registry.entries);
    if (next === null) {
      return;
    }
    await writeRegistryFile(registryPath, { entries: next });
  });
}

export async function updateRegistry(entry: SandboxRegistryEntry) {
  await withRegistryMutation<SandboxRegistryEntry>(SANDBOX_REGISTRY_PATH, (entries) =>
    upsertEntry(entries, entry),
  );
}

export async function removeRegistryEntry(containerName: string) {
  await withRegistryMutation<SandboxRegistryEntry>(SANDBOX_REGISTRY_PATH, (entries) => {
    const next = removeEntry(entries, containerName);
    if (next.length === entries.length) {
      return null;
    }
    return next;
  });
}

export async function readBrowserRegistry(): Promise<SandboxBrowserRegistry> {
  return await readRegistryFromFile<SandboxBrowserRegistryEntry>(
    SANDBOX_BROWSER_REGISTRY_PATH,
    "fallback",
    isBrowserRegistryEntry,
  );
}

export async function updateBrowserRegistry(entry: SandboxBrowserRegistryEntry) {
  await withRegistryMutation<SandboxBrowserRegistryEntry>(
    SANDBOX_BROWSER_REGISTRY_PATH,
    (entries) => upsertEntry(entries, entry),
  );
}

export async function removeBrowserRegistryEntry(containerName: string) {
  await withRegistryMutation<SandboxBrowserRegistryEntry>(
    SANDBOX_BROWSER_REGISTRY_PATH,
    (entries) => {
      const next = removeEntry(entries, containerName);
      if (next.length === entries.length) {
        return null;
      }
      return next;
    },
  );
}
