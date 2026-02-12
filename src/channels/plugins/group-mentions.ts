import type { SpecialAgentConfig } from "../../config/config.js";
import type { GroupToolPolicyConfig } from "../../config/types.tools.js";
import {
  resolveChannelGroupRequireMention,
  resolveChannelGroupToolsPolicy,
} from "../../config/group-policy.js";

type GroupMentionParams = {
  cfg: SpecialAgentConfig;
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
  accountId?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
};

// All channel-specific group mention resolvers have been removed.
// Extension channels should implement group mention resolution via their plugin adapters.
// The generic resolveChannelGroupRequireMention and resolveChannelGroupToolsPolicy
// from config/group-policy.js can be used by extensions directly.

export type { GroupMentionParams };
export { resolveChannelGroupRequireMention, resolveChannelGroupToolsPolicy };
