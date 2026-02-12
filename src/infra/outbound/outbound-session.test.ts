import { describe, expect, it } from "vitest";
import type { SpecialAgentConfig } from "../../config/config.js";
import { resolveOutboundSessionRoute } from "./outbound-session.js";

const baseConfig = {} as SpecialAgentConfig;

describe("resolveOutboundSessionRoute", () => {
  it("builds MS Teams channel session keys", async () => {
    const route = await resolveOutboundSessionRoute({
      cfg: baseConfig,
      channel: "msteams",
      agentId: "main",
      target: "conversation:19:abc@thread.tacv2",
    });

    expect(route?.sessionKey).toBe("agent:main:msteams:channel:19:abc@thread.tacv2");
    expect(route?.from).toBe("msteams:channel:19:abc@thread.tacv2");
    expect(route?.to).toBe("conversation:19:abc@thread.tacv2");
  });

  it("resolves fallback session for unregistered channels with per-channel-peer scope", async () => {
    const cfg = { session: { dmScope: "per-channel-peer" } } as SpecialAgentConfig;
    const route = await resolveOutboundSessionRoute({
      cfg,
      channel: "telegram",
      agentId: "main",
      target: "-100123456",
    });

    // Without a registered channel, falls to fallback session resolver
    expect(route?.sessionKey).toBe("agent:main:telegram:direct:-100123456");
    expect(route?.from).toBe("telegram:-100123456");
    expect(route?.chatType).toBe("direct");
  });

  it("treats Telegram usernames as DMs when unresolved", async () => {
    const cfg = { session: { dmScope: "per-channel-peer" } } as SpecialAgentConfig;
    const route = await resolveOutboundSessionRoute({
      cfg,
      channel: "telegram",
      agentId: "main",
      target: "@alice",
    });

    expect(route?.sessionKey).toBe("agent:main:telegram:direct:@alice");
    expect(route?.chatType).toBe("direct");
  });

  it("honors dmScope identity links", async () => {
    const cfg = {
      session: {
        dmScope: "per-peer",
        identityLinks: {
          alice: ["discord:123"],
        },
      },
    } as SpecialAgentConfig;

    const route = await resolveOutboundSessionRoute({
      cfg,
      channel: "discord",
      agentId: "main",
      target: "user:123",
    });

    expect(route?.sessionKey).toBe("agent:main:direct:alice");
  });

  it("strips chat_* prefixes for BlueBubbles group session keys", async () => {
    const route = await resolveOutboundSessionRoute({
      cfg: baseConfig,
      channel: "bluebubbles",
      agentId: "main",
      target: "chat_guid:ABC123",
    });

    expect(route?.sessionKey).toBe("agent:main:bluebubbles:group:abc123");
    expect(route?.from).toBe("group:ABC123");
  });

  it("treats Zalo Personal DM targets as direct sessions", async () => {
    const cfg = { session: { dmScope: "per-channel-peer" } } as SpecialAgentConfig;
    const route = await resolveOutboundSessionRoute({
      cfg,
      channel: "zalouser",
      agentId: "main",
      target: "123456",
    });

    expect(route?.sessionKey).toBe("agent:main:zalouser:direct:123456");
    expect(route?.chatType).toBe("direct");
  });

  it("resolves MS Teams user session keys", async () => {
    const route = await resolveOutboundSessionRoute({
      cfg: baseConfig,
      channel: "msteams",
      agentId: "main",
      target: "user:29:abc-def-ghi",
    });

    expect(route?.sessionKey).toBe("agent:main:main");
    expect(route?.from).toBe("msteams:29:abc-def-ghi");
    expect(route?.chatType).toBe("direct");
  });
});
