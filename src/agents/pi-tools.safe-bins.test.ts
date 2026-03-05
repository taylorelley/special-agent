import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SpecialAgentConfig } from "../config/config.js";
import type { ExecApprovalsResolved } from "../infra/exec-approvals.js";

const previousBundledPluginsDir = process.env.SPECIAL_AGENT_BUNDLED_PLUGINS_DIR;

beforeAll(() => {
  process.env.SPECIAL_AGENT_BUNDLED_PLUGINS_DIR = path.join(
    os.tmpdir(),
    "special-agent-test-no-bundled-extensions",
  );
});

afterAll(() => {
  if (previousBundledPluginsDir === undefined) {
    delete process.env.SPECIAL_AGENT_BUNDLED_PLUGINS_DIR;
  } else {
    process.env.SPECIAL_AGENT_BUNDLED_PLUGINS_DIR = previousBundledPluginsDir;
  }
});

vi.mock("../infra/shell-env.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/shell-env.js")>();
  return {
    ...mod,
    getShellPathFromLoginShell: vi.fn(() => "/usr/bin:/bin"),
    resolveShellEnvFallbackTimeoutMs: vi.fn(() => 500),
  };
});

vi.mock("../plugins/tools.js", () => ({
  getPluginToolMeta: () => undefined,
  resolvePluginTools: () => [],
}));

vi.mock("../infra/exec-approvals.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/exec-approvals.js")>();
  const approvals: ExecApprovalsResolved = {
    path: "/tmp/exec-approvals.json",
    socketPath: "/tmp/exec-approvals.sock",
    token: "token",
    defaults: {
      security: "allowlist",
      ask: "off",
      askFallback: "deny",
      autoAllowSkills: false,
    },
    agent: {
      security: "allowlist",
      ask: "off",
      askFallback: "deny",
      autoAllowSkills: false,
    },
    allowlist: [],
    file: {
      version: 1,
      socket: { path: "/tmp/exec-approvals.sock", token: "token" },
      defaults: {
        security: "allowlist",
        ask: "off",
        askFallback: "deny",
        autoAllowSkills: false,
      },
      agents: {},
    },
  };
  return { ...mod, resolveExecApprovals: () => approvals };
});

describe("createSpecialAgentCodingTools safeBins", () => {
  it("threads tools.exec.safeBins into exec allowlist checks", async () => {
    if (process.platform === "win32") {
      return;
    }

    const { createSpecialAgentCodingTools } = await import("./pi-tools.js");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "special-agent-safe-bins-"));
    const cfg: SpecialAgentConfig = {
      tools: {
        exec: {
          host: "gateway",
          security: "allowlist",
          ask: "off",
          safeBins: ["jq"],
        },
      },
    };

    const tools = createSpecialAgentCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: tmpDir,
      agentDir: path.join(tmpDir, "agent"),
    });
    const execTool = tools.find((tool) => tool.name === "exec");
    expect(execTool).toBeDefined();

    const prevShellEnvTimeoutMs = process.env.SPECIAL_AGENT_SHELL_ENV_TIMEOUT_MS;
    process.env.SPECIAL_AGENT_SHELL_ENV_TIMEOUT_MS = "1000";
    // Use `jq '.'` with no flags — the safe-bin profile for jq rejects
    // unknown short flags like `-n`.  The filter-only form is the simplest
    // invocation accepted by the profile (maxPositional: 1, no flags).
    // The command blocks on stdin so it will time out, but the key
    // assertion is that it was *allowed* past the safe-bin allowlist
    // (an allowlist miss throws synchronously before spawning).
    let allowlistDenied = false;
    try {
      await execTool!.execute("call1", {
        command: `jq '.'`,
        workdir: tmpDir,
        timeout: 2,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("exec denied")) {
        allowlistDenied = true;
      }
      // Other errors (e.g. timeout) are expected — jq blocks on stdin.
    } finally {
      if (prevShellEnvTimeoutMs === undefined) {
        delete process.env.SPECIAL_AGENT_SHELL_ENV_TIMEOUT_MS;
      } else {
        process.env.SPECIAL_AGENT_SHELL_ENV_TIMEOUT_MS = prevShellEnvTimeoutMs;
      }
    }

    expect(allowlistDenied).toBe(false);
  });
});
