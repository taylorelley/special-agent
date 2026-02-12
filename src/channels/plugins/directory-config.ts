import type { SpecialAgentConfig } from "../../config/types.js";
import type { ChannelDirectoryEntry } from "./types.js";

export type DirectoryConfigParams = {
  cfg: SpecialAgentConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};

// All channel-specific directory config functions have been removed.
// Extension channels should implement directory listing via their plugin adapters.
