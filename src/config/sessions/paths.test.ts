import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStorePath } from "./paths.js";

describe("resolveStorePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses SPECIAL_AGENT_HOME for tilde expansion", () => {
    vi.stubEnv("SPECIAL_AGENT_HOME", "/srv/special-agent-home");
    vi.stubEnv("HOME", "/home/other");

    const resolved = resolveStorePath("~/.special-agent/agents/{agentId}/sessions/sessions.json", {
      agentId: "research",
    });

    expect(resolved).toBe(
      path.resolve("/srv/special-agent-home/.special-agent/agents/research/sessions/sessions.json"),
    );
  });
});
