import crypto from "node:crypto";
import { callGateway } from "../../gateway/call.js";
import { extractTextFromChatContent } from "../../shared/chat-content.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import { AGENT_LANE_NESTED } from "../lanes.js";
import { extractAssistantText, stripToolMessages } from "./sessions-helpers.js";

export async function readLatestAssistantReply(params: {
  sessionKey: string;
  limit?: number;
}): Promise<string | undefined> {
  const history = await callGateway<{ messages: Array<unknown> }>({
    method: "chat.history",
    params: { sessionKey: params.sessionKey, limit: params.limit ?? 50 },
  });
  const filtered = stripToolMessages(Array.isArray(history?.messages) ? history.messages : []);
  const last = filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
  return last ? extractAssistantText(last) : undefined;
}

type ContentBlock = { type: string; text?: string };

/**
 * Read the latest subagent output, including both assistant and tool role messages.
 * More comprehensive than readLatestAssistantReply — also captures tool result text
 * that may appear after the last assistant message.
 */
export async function readLatestSubagentOutput(params: {
  sessionKey: string;
  limit?: number;
}): Promise<string | undefined> {
  const history = await callGateway<{ messages: Array<unknown> }>({
    method: "chat.history",
    params: { sessionKey: params.sessionKey, limit: params.limit ?? 50 },
  });
  const messages = Array.isArray(history?.messages) ? history.messages : [];

  // Walk backwards to find the last assistant or tool_result message
  const parts: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (!msg) {
      continue;
    }

    const role = msg.role;
    if (role === "assistant") {
      const text = extractTextFromChatContent(msg.content as string | ContentBlock[] | undefined, {
        sanitize: true,
      });
      if (text?.trim()) {
        parts.unshift(text.trim());
      }
      break;
    }
    if (role === "tool") {
      const text = extractTextFromChatContent(msg.content as string | ContentBlock[] | undefined, {
        sanitize: true,
      });
      if (text?.trim()) {
        parts.unshift(text.trim());
      }
      // Keep looking for the preceding assistant message
      continue;
    }
    // Stop at any other role (user, system)
    break;
  }

  return parts.length > 0 ? parts.join("\n") : undefined;
}

export async function runAgentStep(params: {
  sessionKey: string;
  message: string;
  extraSystemPrompt: string;
  timeoutMs: number;
  channel?: string;
  lane?: string;
}): Promise<string | undefined> {
  const stepIdem = crypto.randomUUID();
  const response = await callGateway<{ runId?: string }>({
    method: "agent",
    params: {
      message: params.message,
      sessionKey: params.sessionKey,
      idempotencyKey: stepIdem,
      deliver: false,
      channel: params.channel ?? INTERNAL_MESSAGE_CHANNEL,
      lane: params.lane ?? AGENT_LANE_NESTED,
      extraSystemPrompt: params.extraSystemPrompt,
    },
    timeoutMs: 10_000,
  });

  const stepRunId = typeof response?.runId === "string" && response.runId ? response.runId : "";
  const resolvedRunId = stepRunId || stepIdem;
  const stepWaitMs = Math.min(params.timeoutMs, 60_000);
  const wait = await callGateway<{ status?: string }>({
    method: "agent.wait",
    params: {
      runId: resolvedRunId,
      timeoutMs: stepWaitMs,
    },
    timeoutMs: stepWaitMs + 2000,
  });
  if (wait?.status !== "ok") {
    return undefined;
  }
  return await readLatestAssistantReply({ sessionKey: params.sessionKey });
}
