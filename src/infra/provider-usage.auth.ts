import type { UsageProviderId } from "./provider-usage.types.js";

export type ProviderAuth = {
  provider: UsageProviderId;
  token: string;
  accountId?: string;
};

export async function resolveProviderAuths(_params: {
  providers: UsageProviderId[];
  auth?: ProviderAuth[];
  agentDir?: string;
}): Promise<ProviderAuth[]> {
  if (_params.auth) {
    return _params.auth;
  }
  // No built-in provider auth resolution in enterprise mode.
  return [];
}
