import type { SpecialAgentConfig } from "../../../config/config.js";
import type { RuntimeEnv } from "../../../runtime.js";
import type { OnboardOptions } from "../../onboard-types.js";

export function applyNonInteractiveWebToolsConfig(params: {
  nextConfig: SpecialAgentConfig;
  opts: OnboardOptions;
  runtime: RuntimeEnv;
}) {
  const { nextConfig, opts } = params;
  if (opts.skipWebTools) {
    return nextConfig;
  }

  const search = opts.braveApiKey
    ? { enabled: true, apiKey: opts.braveApiKey }
    : nextConfig.tools?.web?.search;

  return {
    ...nextConfig,
    tools: {
      ...nextConfig.tools,
      web: {
        ...nextConfig.tools?.web,
        fetch: {
          ...nextConfig.tools?.web?.fetch,
          enabled: true,
        },
        ...(search ? { search } : {}),
      },
    },
  };
}
