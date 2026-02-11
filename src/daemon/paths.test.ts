import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".special-agent"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", SPECIAL_AGENT_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".special-agent-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", SPECIAL_AGENT_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".special-agent"));
  });

  it("uses SPECIAL_AGENT_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", SPECIAL_AGENT_STATE_DIR: "/var/lib/special-agent" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/special-agent"));
  });

  it("expands ~ in SPECIAL_AGENT_STATE_DIR", () => {
    const env = { HOME: "/Users/test", SPECIAL_AGENT_STATE_DIR: "~/special-agent-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/special-agent-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { SPECIAL_AGENT_STATE_DIR: "C:\\State\\special-agent" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\special-agent");
  });
});
