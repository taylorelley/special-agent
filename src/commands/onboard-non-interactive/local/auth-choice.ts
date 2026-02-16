import type { SpecialAgentConfig } from "../../../config/config.js";
import type { RuntimeEnv } from "../../../runtime.js";
import type { AuthChoice, OnboardOptions } from "../../onboard-types.js";
import { upsertAuthProfile } from "../../../agents/auth-profiles.js";
import { normalizeSecretInput } from "../../../utils/normalize-secret-input.js";
import { setProviderApiKey } from "../../onboard-auth.credentials.js";
import { resolveNonInteractiveApiKey } from "../api-keys.js";

export async function applyNonInteractiveAuthChoice(params: {
  nextConfig: SpecialAgentConfig;
  authChoice: AuthChoice;
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  baseConfig: SpecialAgentConfig;
}): Promise<SpecialAgentConfig | null> {
  const { authChoice, opts, runtime } = params;
  const nextConfig = params.nextConfig;

  if (authChoice === "custom-api-key") {
    const resolved = await resolveNonInteractiveApiKey({
      provider: "custom",
      cfg: params.baseConfig,
      flagValue: opts.apiKey,
      flagName: "--api-key",
      envVar: "CUSTOM_API_KEY",
      runtime,
    });
    if (!resolved) {
      return null;
    }
    if (resolved.source !== "profile") {
      await setProviderApiKey("custom", resolved.key);
    }
    return nextConfig;
  }

  if (authChoice === "ollama") {
    // Ollama needs no API key
    return nextConfig;
  }

  return nextConfig;
}
