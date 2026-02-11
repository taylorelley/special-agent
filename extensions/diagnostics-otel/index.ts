import type { SpecialAgentPluginApi } from "special-agent/plugin-sdk";
import { emptyPluginConfigSchema } from "special-agent/plugin-sdk";
import { createDiagnosticsOtelService } from "./src/service.js";

const plugin = {
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description: "Export diagnostics events to OpenTelemetry",
  configSchema: emptyPluginConfigSchema(),
  register(api: SpecialAgentPluginApi) {
    api.registerService(createDiagnosticsOtelService());
  },
};

export default plugin;
