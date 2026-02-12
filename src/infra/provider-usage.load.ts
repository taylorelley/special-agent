import type { ProviderAuth } from "./provider-usage.auth.js";
import type { UsageProviderId, UsageSummary } from "./provider-usage.types.js";
import { DEFAULT_TIMEOUT_MS, usageProviders } from "./provider-usage.shared.js";

type UsageSummaryOptions = {
  now?: number;
  timeoutMs?: number;
  providers?: UsageProviderId[];
  auth?: ProviderAuth[];
  agentDir?: string;
  fetch?: typeof fetch;
};

export async function loadProviderUsageSummary(
  opts: UsageSummaryOptions = {},
): Promise<UsageSummary> {
  const now = opts.now ?? Date.now();
  // No built-in provider usage fetchers in enterprise mode.
  return { updatedAt: now, providers: [] };
}
