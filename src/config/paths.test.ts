import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  resolveDefaultConfigCandidates,
  resolveConfigPath,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

describe("oauth paths", () => {
  it("prefers SPECIAL_AGENT_OAUTH_DIR over SPECIAL_AGENT_STATE_DIR", () => {
    const env = {
      SPECIAL_AGENT_OAUTH_DIR: "/custom/oauth",
      SPECIAL_AGENT_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from SPECIAL_AGENT_STATE_DIR when unset", () => {
    const env = {
      SPECIAL_AGENT_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  it("uses SPECIAL_AGENT_STATE_DIR when set", () => {
    const env = {
      SPECIAL_AGENT_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("uses SPECIAL_AGENT_HOME for default state/config locations", () => {
    const env = {
      SPECIAL_AGENT_HOME: "/srv/special-agent-home",
    } as NodeJS.ProcessEnv;

    const resolvedHome = path.resolve("/srv/special-agent-home");
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".special-agent"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".special-agent", "special-agent.json"));
  });

  it("prefers SPECIAL_AGENT_HOME over HOME for default state/config locations", () => {
    const env = {
      SPECIAL_AGENT_HOME: "/srv/special-agent-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv;

    const resolvedHome = path.resolve("/srv/special-agent-home");
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".special-agent"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".special-agent", "special-agent.json"));
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const expected = [
      path.join(resolvedHome, ".special-agent", "special-agent.json"),
      path.join(resolvedHome, ".special-agent", "special-agent.json"),
      path.join(resolvedHome, ".special-agent", "special-agent.json"),
      path.join(resolvedHome, ".special-agent", "special-agent.json"),
    ];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.special-agent when it exists and legacy dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "special-agent-state-"));
    try {
      const newDir = path.join(root, ".special-agent");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "special-agent-config-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousHomeDrive = process.env.HOMEDRIVE;
    const previousHomePath = process.env.HOMEPATH;
    const previousSpecialAgentConfig = process.env.SPECIAL_AGENT_CONFIG_PATH;
    const previousSpecialAgentState = process.env.SPECIAL_AGENT_STATE_DIR;
    try {
      const legacyDir = path.join(root, ".special-agent");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "special-agent.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      process.env.HOME = root;
      if (process.platform === "win32") {
        process.env.USERPROFILE = root;
        const parsed = path.win32.parse(root);
        process.env.HOMEDRIVE = parsed.root.replace(/\\$/, "");
        process.env.HOMEPATH = root.slice(parsed.root.length - 1);
      }
      delete process.env.SPECIAL_AGENT_CONFIG_PATH;
      delete process.env.SPECIAL_AGENT_STATE_DIR;

      vi.resetModules();
      const { CONFIG_PATH } = await import("./paths.js");
      expect(CONFIG_PATH).toBe(legacyPath);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      if (previousHomeDrive === undefined) {
        delete process.env.HOMEDRIVE;
      } else {
        process.env.HOMEDRIVE = previousHomeDrive;
      }
      if (previousHomePath === undefined) {
        delete process.env.HOMEPATH;
      } else {
        process.env.HOMEPATH = previousHomePath;
      }
      if (previousSpecialAgentConfig === undefined) {
        delete process.env.SPECIAL_AGENT_CONFIG_PATH;
      } else {
        process.env.SPECIAL_AGENT_CONFIG_PATH = previousSpecialAgentConfig;
      }
      if (previousSpecialAgentConfig === undefined) {
        delete process.env.SPECIAL_AGENT_CONFIG_PATH;
      } else {
        process.env.SPECIAL_AGENT_CONFIG_PATH = previousSpecialAgentConfig;
      }
      if (previousSpecialAgentState === undefined) {
        delete process.env.SPECIAL_AGENT_STATE_DIR;
      } else {
        process.env.SPECIAL_AGENT_STATE_DIR = previousSpecialAgentState;
      }
      if (previousSpecialAgentState === undefined) {
        delete process.env.SPECIAL_AGENT_STATE_DIR;
      } else {
        process.env.SPECIAL_AGENT_STATE_DIR = previousSpecialAgentState;
      }
      await fs.rm(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "special-agent-config-override-"));
    try {
      const legacyDir = path.join(root, ".special-agent");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "special-agent.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { SPECIAL_AGENT_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "special-agent.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
