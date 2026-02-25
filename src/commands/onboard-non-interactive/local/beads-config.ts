import type { SpecialAgentConfig } from "../../../config/config.js";
import type { RuntimeEnv } from "../../../runtime.js";
import type { OnboardOptions } from "../../onboard-types.js";
import { applyBeadsConfig } from "../../onboard-beads.js";

export function applyNonInteractiveBeadsConfig(params: {
  nextConfig: SpecialAgentConfig;
  opts: OnboardOptions;
  runtime: RuntimeEnv;
}) {
  const { nextConfig, opts } = params;
  if (opts.skipBeads) {
    return nextConfig;
  }

  return applyBeadsConfig(nextConfig, { enabled: false });
}
