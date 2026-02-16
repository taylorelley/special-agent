import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { resolveSpecialAgentAgentDir } from "../agents/agent-paths.js";
import { upsertAuthProfile } from "../agents/auth-profiles.js";

const resolveAuthAgentDir = (agentDir?: string) => agentDir ?? resolveSpecialAgentAgentDir();

export async function writeOAuthCredentials(
  provider: string,
  creds: OAuthCredentials,
  agentDir?: string,
): Promise<void> {
  const email =
    typeof creds.email === "string" && creds.email.trim() ? creds.email.trim() : "default";
  upsertAuthProfile({
    profileId: `${provider}:${email}`,
    credential: {
      type: "oauth",
      provider,
      ...creds,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}

/**
 * Applies an auth-profile reference into the config's provider block.
 */
export function applyAuthProfileConfig(
  cfg: import("../config/config.js").SpecialAgentConfig,
  params: { profileId: string; provider: string; mode: string; email?: string },
): import("../config/config.js").SpecialAgentConfig {
  const providers = { ...cfg.models?.providers };
  const existing = providers[params.provider];
  providers[params.provider] = {
    ...(existing ?? { baseUrl: "", models: [] }),
    auth: params.mode as import("../config/types.models.js").ModelProviderAuthMode,
    authProfile: params.profileId,
  } as import("../config/types.models.js").ModelProviderConfig;
  return {
    ...cfg,
    models: {
      ...cfg.models,
      providers,
    },
  };
}

/**
 * Generic API key setter for any provider.
 */
export async function setProviderApiKey(
  provider: string,
  key: string,
  agentDir?: string,
): Promise<void> {
  upsertAuthProfile({
    profileId: `${provider}:default`,
    credential: {
      type: "api_key",
      provider,
      key,
    },
    agentDir: resolveAuthAgentDir(agentDir),
  });
}
