import { describe, expect, it } from "vitest";
import { applyPluginAutoEnable } from "./plugin-auto-enable.js";

describe("applyPluginAutoEnable", () => {
  it("configures channel plugins with disabled state and updates allowlist", () => {
    const result = applyPluginAutoEnable({
      config: {
        channels: { slack: { botToken: "x" } },
        plugins: { allow: ["telegram"] },
      },
      env: {},
    });

    expect(result.config.plugins?.entries?.slack?.enabled).toBe(false);
    expect(result.config.plugins?.allow).toEqual(["telegram", "slack"]);
    // Generic detection uses lowercase channel id
    expect(result.changes.join("\n")).toContain("slack configured, not enabled yet.");
  });

  it("respects explicit disable", () => {
    const result = applyPluginAutoEnable({
      config: {
        channels: { slack: { botToken: "x" } },
        plugins: { entries: { slack: { enabled: false } } },
      },
      env: {},
    });

    expect(result.config.plugins?.entries?.slack?.enabled).toBe(false);
    expect(result.changes).toEqual([]);
  });

  it("does not detect irc via env since channel-specific env detection was removed", () => {
    const result = applyPluginAutoEnable({
      config: {},
      env: {
        IRC_HOST: "irc.libera.chat",
        IRC_NICK: "special-agent-bot",
      },
    });

    // CHANNEL_PLUGIN_IDS is empty, and no channels.irc config key exists,
    // so IRC is not detected via env anymore
    expect(result.config.plugins?.entries?.irc?.enabled).toBeUndefined();
    expect(result.changes).toEqual([]);
  });

  it("does not auto-detect provider auth plugins since PROVIDER_PLUGIN_IDS is empty", () => {
    const result = applyPluginAutoEnable({
      config: {
        auth: {
          profiles: {
            "google-antigravity:default": {
              provider: "google-antigravity",
              mode: "oauth",
            },
          },
        },
      },
      env: {},
    });

    // PROVIDER_PLUGIN_IDS is empty, so no provider auth plugins are auto-detected
    expect(result.config.plugins?.entries?.["google-antigravity-auth"]?.enabled).toBeUndefined();
    expect(result.changes).toEqual([]);
  });

  it("skips when plugins are globally disabled", () => {
    const result = applyPluginAutoEnable({
      config: {
        channels: { slack: { botToken: "x" } },
        plugins: { enabled: false },
      },
      env: {},
    });

    expect(result.config.plugins?.entries?.slack?.enabled).toBeUndefined();
    expect(result.changes).toEqual([]);
  });

  describe("preferOver channel prioritization", () => {
    it("configures both bluebubbles and imessage since preferOver is now empty", () => {
      const result = applyPluginAutoEnable({
        config: {
          channels: {
            bluebubbles: { serverUrl: "http://localhost:1234", password: "x" },
            imessage: { cliPath: "/usr/local/bin/imsg" },
          },
        },
        env: {},
      });

      // resolvePreferredOverIds now returns [] so both get configured
      expect(result.config.plugins?.entries?.bluebubbles?.enabled).toBe(false);
      expect(result.config.plugins?.entries?.imessage?.enabled).toBe(false);
      expect(result.changes.join("\n")).toContain("bluebubbles configured, not enabled yet.");
      expect(result.changes.join("\n")).toContain("imessage configured, not enabled yet.");
    });

    it("keeps imessage enabled if already explicitly enabled (non-destructive)", () => {
      const result = applyPluginAutoEnable({
        config: {
          channels: {
            bluebubbles: { serverUrl: "http://localhost:1234", password: "x" },
            imessage: { cliPath: "/usr/local/bin/imsg" },
          },
          plugins: { entries: { imessage: { enabled: true } } },
        },
        env: {},
      });

      expect(result.config.plugins?.entries?.bluebubbles?.enabled).toBe(false);
      expect(result.config.plugins?.entries?.imessage?.enabled).toBe(true);
    });

    it("allows imessage auto-configure when bluebubbles is explicitly disabled", () => {
      const result = applyPluginAutoEnable({
        config: {
          channels: {
            bluebubbles: { serverUrl: "http://localhost:1234", password: "x" },
            imessage: { cliPath: "/usr/local/bin/imsg" },
          },
          plugins: { entries: { bluebubbles: { enabled: false } } },
        },
        env: {},
      });

      expect(result.config.plugins?.entries?.bluebubbles?.enabled).toBe(false);
      expect(result.config.plugins?.entries?.imessage?.enabled).toBe(false);
      // Generic detection uses lowercase channel id
      expect(result.changes.join("\n")).toContain("imessage configured, not enabled yet.");
    });

    it("allows imessage auto-configure when bluebubbles is in deny list", () => {
      const result = applyPluginAutoEnable({
        config: {
          channels: {
            bluebubbles: { serverUrl: "http://localhost:1234", password: "x" },
            imessage: { cliPath: "/usr/local/bin/imsg" },
          },
          plugins: { deny: ["bluebubbles"] },
        },
        env: {},
      });

      expect(result.config.plugins?.entries?.bluebubbles?.enabled).toBeUndefined();
      expect(result.config.plugins?.entries?.imessage?.enabled).toBe(false);
    });

    it("configures imessage as disabled when only imessage is configured", () => {
      const result = applyPluginAutoEnable({
        config: {
          channels: { imessage: { cliPath: "/usr/local/bin/imsg" } },
        },
        env: {},
      });

      expect(result.config.plugins?.entries?.imessage?.enabled).toBe(false);
      // Generic detection uses lowercase channel id
      expect(result.changes.join("\n")).toContain("imessage configured, not enabled yet.");
    });
  });
});
