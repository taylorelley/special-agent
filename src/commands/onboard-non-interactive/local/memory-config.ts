import type { SpecialAgentConfig } from "../../../config/config.js";
import type { RuntimeEnv } from "../../../runtime.js";
import type { OnboardOptions } from "../../onboard-types.js";
import { applyMemorySlot } from "../../onboard-memory.js";

export function applyNonInteractiveMemoryConfig(params: {
  nextConfig: SpecialAgentConfig;
  opts: OnboardOptions;
  runtime: RuntimeEnv;
}) {
  const { nextConfig, opts } = params;
  if (opts.skipMemory) {
    return nextConfig;
  }

  return applyMemorySlot(nextConfig, "memory-core");
}
