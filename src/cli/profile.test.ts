import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "special-agent",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "special-agent", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "special-agent", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "special-agent", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "special-agent", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "special-agent", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "special-agent", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs([
      "node",
      "special-agent",
      "--dev",
      "--profile",
      "work",
      "status",
    ]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs([
      "node",
      "special-agent",
      "--profile",
      "work",
      "--dev",
      "status",
    ]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".special-agent-dev");
    expect(env.SPECIAL_AGENT_PROFILE).toBe("dev");
    expect(env.SPECIAL_AGENT_STATE_DIR).toBe(expectedStateDir);
    expect(env.SPECIAL_AGENT_CONFIG_PATH).toBe(path.join(expectedStateDir, "special-agent.json"));
    expect(env.SPECIAL_AGENT_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      SPECIAL_AGENT_STATE_DIR: "/custom",
      SPECIAL_AGENT_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.SPECIAL_AGENT_STATE_DIR).toBe("/custom");
    expect(env.SPECIAL_AGENT_GATEWAY_PORT).toBe("19099");
    expect(env.SPECIAL_AGENT_CONFIG_PATH).toBe(path.join("/custom", "special-agent.json"));
  });

  it("uses SPECIAL_AGENT_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      SPECIAL_AGENT_HOME: "/srv/special-agent-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/special-agent-home");
    expect(env.SPECIAL_AGENT_STATE_DIR).toBe(path.join(resolvedHome, ".special-agent-work"));
    expect(env.SPECIAL_AGENT_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".special-agent-work", "special-agent.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("special-agent doctor --fix", {})).toBe("special-agent doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(
      formatCliCommand("special-agent doctor --fix", { SPECIAL_AGENT_PROFILE: "default" }),
    ).toBe("special-agent doctor --fix");
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(
      formatCliCommand("special-agent doctor --fix", { SPECIAL_AGENT_PROFILE: "Default" }),
    ).toBe("special-agent doctor --fix");
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(
      formatCliCommand("special-agent doctor --fix", { SPECIAL_AGENT_PROFILE: "bad profile" }),
    ).toBe("special-agent doctor --fix");
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(
      formatCliCommand("special-agent --profile work doctor --fix", {
        SPECIAL_AGENT_PROFILE: "work",
      }),
    ).toBe("special-agent --profile work doctor --fix");
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("special-agent --dev doctor", { SPECIAL_AGENT_PROFILE: "dev" })).toBe(
      "special-agent --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("special-agent doctor --fix", { SPECIAL_AGENT_PROFILE: "work" })).toBe(
      "special-agent --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(
      formatCliCommand("special-agent doctor --fix", {
        SPECIAL_AGENT_PROFILE: "  jbspecial-agent  ",
      }),
    ).toBe("special-agent --profile jbspecial-agent doctor --fix");
  });

  it("handles command with no args after special-agent", () => {
    expect(formatCliCommand("special-agent", { SPECIAL_AGENT_PROFILE: "test" })).toBe(
      "special-agent --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm special-agent doctor", { SPECIAL_AGENT_PROFILE: "work" })).toBe(
      "pnpm special-agent --profile work doctor",
    );
  });
});
