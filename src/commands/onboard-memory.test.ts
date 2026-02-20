import { type SpawnSyncReturns } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpecialAgentConfig } from "../config/config.js";
import type { WizardPrompter } from "../wizard/prompts.js";

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted so they're available to vi.mock factories)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn<() => Partial<SpawnSyncReturns<Buffer>>>(() => ({
    pid: 0,
    status: 0,
    signal: null,
    output: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  })),
  checkDocker: vi.fn(async () => ({ available: true, installed: true })),
  runCommandWithTimeout: vi.fn(async () => ({ code: 1, stdout: "", stderr: "" })),
  restoreTerminalState: vi.fn(),
  userInfo: vi.fn(() => ({
    username: "testuser",
    uid: 1000,
    gid: 1000,
    homedir: "/home/testuser",
    shell: "/bin/bash",
  })),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawnSync: mocks.spawnSync };
});

vi.mock("../process/docker.js", () => ({
  checkDocker: mocks.checkDocker,
}));

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: mocks.runCommandWithTimeout,
}));

vi.mock("../terminal/restore.js", () => ({
  restoreTerminalState: mocks.restoreTerminalState,
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, default: { ...actual, userInfo: mocks.userInfo } };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePrompter = (overrides: Partial<WizardPrompter> = {}): WizardPrompter => ({
  intro: vi.fn(async () => {}),
  outro: vi.fn(async () => {}),
  note: vi.fn(async () => {}),
  select: vi.fn(async () => "memory-cognee") as WizardPrompter["select"],
  multiselect: vi.fn(async () => []) as WizardPrompter["multiselect"],
  text: vi.fn(async () => "") as WizardPrompter["text"],
  confirm: vi.fn(async () => true),
  progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
  ...overrides,
});

const baseCfg: SpecialAgentConfig = {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setupMemory – offerDockerGroupFix path", () => {
  let setupMemory: typeof import("./onboard-memory.js").setupMemory;

  beforeEach(async () => {
    vi.resetAllMocks();

    // Default: Docker installed but permission denied on Linux
    mocks.checkDocker.mockResolvedValue({
      available: false,
      installed: true,
      reason: "Permission denied. Add your user to the docker group or run with sudo.",
    });
    mocks.userInfo.mockReturnValue({
      username: "testuser",
      uid: 1000,
      gid: 1000,
      homedir: "/home/testuser",
      shell: "/bin/bash",
    });

    // Re-import to pick up fresh mocks
    ({ setupMemory } = await import("./onboard-memory.js"));
  });

  /**
   * Helper that triggers the docker-group-fix path by selecting cognee while
   * Docker reports a "Permission denied" error on Linux.
   */
  async function runWithDockerPermissionDenied(
    prompterOverrides: Partial<WizardPrompter> = {},
    platform = "linux",
  ) {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    try {
      const prompter = makePrompter(prompterOverrides);
      const result = await setupMemory(
        baseCfg,
        "/workspace",
        { log: vi.fn(), error: vi.fn(), exit: vi.fn() as never },
        prompter,
        "quickstart",
      );
      return { result, prompter };
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  }

  it("calls restoreTerminalState, pauses stdin, then spawnSync — in that order", async () => {
    const callOrder: string[] = [];
    const stdinPauseSpy = vi.spyOn(process.stdin, "pause").mockImplementation(() => {
      callOrder.push("stdin.pause");
      return process.stdin;
    });
    mocks.restoreTerminalState.mockImplementation(() => {
      callOrder.push("restoreTerminalState");
    });
    mocks.spawnSync.mockImplementation((..._args: unknown[]) => {
      callOrder.push("spawnSync");
      return {
        pid: 1,
        status: 0,
        signal: null,
        output: [],
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      };
    });

    await runWithDockerPermissionDenied();

    expect(mocks.restoreTerminalState).toHaveBeenCalledWith("pre-docker-usermod");
    expect(stdinPauseSpy).toHaveBeenCalled();
    expect(mocks.spawnSync).toHaveBeenCalledWith("sudo", ["usermod", "-aG", "docker", "testuser"], {
      stdio: "inherit",
    });
    expect(callOrder).toEqual(["restoreTerminalState", "stdin.pause", "spawnSync"]);

    stdinPauseSpy.mockRestore();
  });

  it("shows success note when sudo usermod succeeds", async () => {
    mocks.spawnSync.mockReturnValue({
      pid: 1,
      status: 0,
      signal: null,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });

    const { prompter } = await runWithDockerPermissionDenied();

    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Added testuser to the docker group"),
      "Memory",
    );
  });

  it("shows spawn error when result.error is set", async () => {
    mocks.spawnSync.mockReturnValue({
      pid: 0,
      status: null,
      signal: null,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      error: new Error("ENOENT: sudo not found"),
    });

    const { prompter } = await runWithDockerPermissionDenied();

    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Failed to run sudo"),
      "Memory",
    );
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("ENOENT: sudo not found"),
      "Memory",
    );
  });

  it("shows generic failure note when sudo exits non-zero", async () => {
    mocks.spawnSync.mockReturnValue({
      pid: 1,
      status: 1,
      signal: null,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });

    const { prompter } = await runWithDockerPermissionDenied();

    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Failed to add user to the docker group"),
      "Memory",
    );
  });

  it("does not call spawnSync or touch terminal state when user declines", async () => {
    const stdinPauseSpy = vi.spyOn(process.stdin, "pause");

    await runWithDockerPermissionDenied({
      confirm: vi.fn(async () => false),
    });

    expect(mocks.restoreTerminalState).not.toHaveBeenCalled();
    expect(stdinPauseSpy).not.toHaveBeenCalled();
    expect(mocks.spawnSync).not.toHaveBeenCalled();

    stdinPauseSpy.mockRestore();
  });

  it("does not offer docker group fix on non-linux platforms", async () => {
    const { prompter } = await runWithDockerPermissionDenied({}, "darwin");

    // Should fall through to the generic "Cognee requires Docker" note, not the group fix
    expect(mocks.spawnSync).not.toHaveBeenCalled();
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Cognee requires a working Docker installation"),
      "Memory",
    );
  });
});
