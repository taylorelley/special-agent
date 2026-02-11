import type {
  AnyAgentTool,
  SpecialAgentPluginApi,
  SpecialAgentPluginToolFactory,
} from "../../src/plugins/types.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default function register(api: SpecialAgentPluginApi) {
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as SpecialAgentPluginToolFactory,
    { optional: true },
  );
}
