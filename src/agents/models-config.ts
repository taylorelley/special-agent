import fs from "node:fs/promises";
import path from "node:path";
import { type SpecialAgentConfig, loadConfig } from "../config/config.js";
import { isRecord } from "../utils.js";
import { resolveSpecialAgentAgentDir } from "./agent-paths.js";
import { normalizeProviders, type ProviderConfig } from "./models-config.providers.js";

type ModelsConfig = NonNullable<SpecialAgentConfig["models"]>;

const DEFAULT_MODE: NonNullable<ModelsConfig["mode"]> = "merge";

async function readJson(pathname: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(pathname, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function ensureSpecialAgentModelsJson(
  config?: SpecialAgentConfig,
  agentDirOverride?: string,
): Promise<{ agentDir: string; wrote: boolean }> {
  const cfg = config ?? loadConfig();
  const agentDir = agentDirOverride?.trim()
    ? agentDirOverride.trim()
    : resolveSpecialAgentAgentDir();

  const explicitProviders = cfg.models?.providers ?? {};
  const providers: Record<string, ProviderConfig> = { ...explicitProviders };

  if (Object.keys(providers).length === 0) {
    return { agentDir, wrote: false };
  }

  const mode = cfg.models?.mode ?? DEFAULT_MODE;
  const targetPath = path.join(agentDir, "models.json");

  let mergedProviders = providers;
  let existingRaw = "";
  if (mode === "merge") {
    const existing = await readJson(targetPath);
    if (isRecord(existing) && isRecord(existing.providers)) {
      const existingProviders = existing.providers as Record<
        string,
        NonNullable<ModelsConfig["providers"]>[string]
      >;
      mergedProviders = { ...existingProviders, ...providers };
    }
  }

  const normalizedProviders = normalizeProviders({
    providers: mergedProviders,
    agentDir,
  });
  const next = `${JSON.stringify({ providers: normalizedProviders }, null, 2)}\n`;
  try {
    existingRaw = await fs.readFile(targetPath, "utf8");
  } catch {
    existingRaw = "";
  }

  if (existingRaw === next) {
    return { agentDir, wrote: false };
  }

  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(targetPath, next, { mode: 0o600 });
  return { agentDir, wrote: true };
}
