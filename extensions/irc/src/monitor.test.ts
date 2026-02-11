import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#special-agent",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#special-agent",
      rawTarget: "#special-agent",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "special-agent-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "special-agent-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "special-agent-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "special-agent-bot",
      rawTarget: "special-agent-bot",
    });
  });
});
