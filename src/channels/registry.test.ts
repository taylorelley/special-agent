import { describe, expect, it } from "vitest";
import { listChatChannels, normalizeChatChannelId } from "./registry.js";

describe("channel registry", () => {
  it("returns empty list when no core channels are registered", () => {
    const channels = listChatChannels();
    expect(channels).toEqual([]);
  });

  it("returns null for former aliases since no core channels are registered", () => {
    expect(normalizeChatChannelId("imsg")).toBeNull();
    expect(normalizeChatChannelId("gchat")).toBeNull();
    expect(normalizeChatChannelId("telegram")).toBeNull();
    expect(normalizeChatChannelId("web")).toBeNull();
  });
});
