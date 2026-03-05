import type { ChannelId } from "../../channels/plugins/types.js";
import type { SpecialAgentConfig } from "../../config/config.js";
import type { OutboundChannel } from "../../infra/outbound/targets.js";
import { DEFAULT_CHAT_CHANNEL, resolveDefaultChatChannel } from "../../channels/registry.js";
import {
  loadSessionStore,
  resolveAgentMainSessionKey,
  resolveStorePath,
} from "../../config/sessions.js";
import { resolveMessageChannelSelection } from "../../infra/outbound/channel-selection.js";
import {
  resolveOutboundTarget,
  resolveSessionDeliveryTarget,
} from "../../infra/outbound/targets.js";

export async function resolveDeliveryTarget(
  cfg: SpecialAgentConfig,
  agentId: string,
  jobPayload: {
    channel?: ChannelId;
    to?: string;
    accountId?: string;
    sessionKey?: string;
  },
): Promise<{
  ok: boolean;
  channel: Exclude<OutboundChannel, "none">;
  to?: string;
  accountId?: string;
  threadId?: string | number;
  mode: "explicit" | "implicit";
  error?: Error;
}> {
  const requestedChannel = typeof jobPayload.channel === "string" ? jobPayload.channel : "last";
  const explicitTo = typeof jobPayload.to === "string" ? jobPayload.to : undefined;
  const allowMismatchedLastTo = requestedChannel === "last";

  const sessionCfg = cfg.session;
  const mainSessionKey = resolveAgentMainSessionKey({ cfg, agentId });
  const storePath = resolveStorePath(sessionCfg?.store, { agentId });
  const store = loadSessionStore(storePath);

  // Look up thread-specific session first (e.g. agent:main:main:thread:1234),
  // then fall back to the main session entry.
  const threadSessionKey = jobPayload.sessionKey?.trim();
  const threadEntry = threadSessionKey ? store[threadSessionKey] : undefined;
  const main = threadEntry ?? store[mainSessionKey];

  const preliminary = resolveSessionDeliveryTarget({
    entry: main,
    requestedChannel,
    explicitTo,
    allowMismatchedLastTo,
  });

  let fallbackChannel: Exclude<OutboundChannel, "none"> | undefined;
  if (!preliminary.channel) {
    if (preliminary.lastChannel) {
      fallbackChannel = preliminary.lastChannel;
    } else {
      try {
        const selection = await resolveMessageChannelSelection({ cfg });
        fallbackChannel = selection.channel;
      } catch {
        fallbackChannel = resolveDefaultChatChannel() ?? DEFAULT_CHAT_CHANNEL;
      }
    }
  }

  const resolved = fallbackChannel
    ? resolveSessionDeliveryTarget({
        entry: main,
        requestedChannel,
        explicitTo,
        fallbackChannel,
        allowMismatchedLastTo,
        mode: preliminary.mode,
      })
    : preliminary;

  const channel =
    resolved.channel ?? fallbackChannel ?? resolveDefaultChatChannel() ?? DEFAULT_CHAT_CHANNEL;
  const mode = resolved.mode as "explicit" | "implicit";
  const toCandidate = resolved.to;

  // Prefer an explicit accountId from the job's delivery config.
  // Fall back to the session's lastAccountId.
  const explicitAccountId =
    typeof jobPayload.accountId === "string" && jobPayload.accountId.trim()
      ? jobPayload.accountId.trim()
      : undefined;
  const accountIdResolved = explicitAccountId ?? resolved.accountId;

  // Only carry threadId when delivering to the same recipient as the session's
  // last conversation. This prevents stale thread IDs (e.g. from a Telegram
  // supergroup topic) from being sent to a different target (e.g. a private
  // chat) where they would cause API errors.
  const threadId =
    resolved.threadId && resolved.to && resolved.to === resolved.lastTo
      ? resolved.threadId
      : undefined;

  if (!toCandidate) {
    return {
      ok: false,
      channel,
      to: undefined,
      accountId: accountIdResolved,
      threadId,
      mode,
      error: new Error(`No delivery target resolved for channel "${channel}". Set delivery.to.`),
    };
  }

  const docked = resolveOutboundTarget({
    channel,
    to: toCandidate,
    cfg,
    accountId: accountIdResolved,
    mode,
  });
  if (!docked.ok) {
    return {
      ok: false,
      channel,
      to: undefined,
      accountId: accountIdResolved,
      threadId,
      mode,
      error: docked.error,
    };
  }
  return {
    ok: true,
    channel,
    to: docked.to,
    accountId: accountIdResolved,
    threadId,
    mode,
  };
}
