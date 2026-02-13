import type { ProviderAuth } from "./provider-usage.auth.js";
import type { UsageProviderId, UsageSummary } from "./provider-usage.types.js";

type UsageSummaryOptions = {
  now?: number;
  timeoutMs?: number;
  providers?: UsageProviderId[];
  auth?: ProviderAuth[];
  agentDir?: string;
  fetch?: typeof fetch;
};

/**
 * Provider usage tracking is disabled in the enterprise build.
 * All built-in usage fetchers have been removed; this stub always returns
 * an empty provider list. Configure usage monitoring via your
 * OpenAI-compatible endpoint's own dashboard.
 */
export async function loadProviderUsageSummary(
  opts: UsageSummaryOptions = {},
): Promise<UsageSummary> {
  const now = opts.now ?? Date.now();
  return { updatedAt: now, providers: [] };
}
