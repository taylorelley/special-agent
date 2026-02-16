import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { SpecialAgentConfig } from "../../config/config.js";
import { readStringParam } from "./common.js";

export async function handleDiscordAction(
  params: Record<string, unknown>,
  _cfg: SpecialAgentConfig,
): Promise<AgentToolResult<unknown>> {
  const action = readStringParam(params, "action", { required: true });
  throw new Error(`Discord action not available: ${action}`);
}
