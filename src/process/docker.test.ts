import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("checkDocker", () => {
  it("returns available when docker info exits 0", async () => {
    vi.doMock("./exec.js", () => ({
      runCommandWithTimeout: vi.fn(),
    }));

    const { checkDocker } = await import("./docker.js");
    const { runCommandWithTimeout } = await import("./exec.js");
    vi.mocked(runCommandWithTimeout).mockResolvedValueOnce({
      stdout: "some info",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
    });

    const result = await checkDocker();
    expect(result).toEqual({ available: true, installed: true });
  });

  it("detects permission denied", async () => {
    vi.doMock("./exec.js", () => ({
      runCommandWithTimeout: vi.fn(),
    }));

    const { checkDocker } = await import("./docker.js");
    const { runCommandWithTimeout } = await import("./exec.js");
    vi.mocked(runCommandWithTimeout).mockResolvedValueOnce({
      stdout: "",
      stderr: "Got permission denied while trying to connect to the Docker daemon socket",
      code: 1,
      signal: null,
      killed: false,
    });

    const result = await checkDocker();
    expect(result.available).toBe(false);
    expect(result.installed).toBe(true);
    expect(result.reason).toMatch(/permission denied/i);
  });

  it("detects daemon not running", async () => {
    vi.doMock("./exec.js", () => ({
      runCommandWithTimeout: vi.fn(),
    }));

    const { checkDocker } = await import("./docker.js");
    const { runCommandWithTimeout } = await import("./exec.js");
    vi.mocked(runCommandWithTimeout).mockResolvedValueOnce({
      stdout: "",
      stderr: "Cannot connect to the Docker daemon. Is the docker daemon running?",
      code: 1,
      signal: null,
      killed: false,
    });

    const result = await checkDocker();
    expect(result.available).toBe(false);
    expect(result.installed).toBe(true);
    expect(result.reason).toMatch(/daemon is not running/i);
  });

  it("detects connection refused as daemon not running", async () => {
    vi.doMock("./exec.js", () => ({
      runCommandWithTimeout: vi.fn(),
    }));

    const { checkDocker } = await import("./docker.js");
    const { runCommandWithTimeout } = await import("./exec.js");
    vi.mocked(runCommandWithTimeout).mockResolvedValueOnce({
      stdout: "",
      stderr: "error during connect: connection refused",
      code: 1,
      signal: null,
      killed: false,
    });

    const result = await checkDocker();
    expect(result.available).toBe(false);
    expect(result.installed).toBe(true);
    expect(result.reason).toMatch(/daemon is not running/i);
  });

  it("returns not installed on ENOENT", async () => {
    vi.doMock("./exec.js", () => ({
      runCommandWithTimeout: vi.fn(),
    }));

    const { checkDocker } = await import("./docker.js");
    const { runCommandWithTimeout } = await import("./exec.js");
    const error = new Error("spawn docker ENOENT") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    vi.mocked(runCommandWithTimeout).mockRejectedValueOnce(error);

    const result = await checkDocker();
    expect(result.available).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.reason).toMatch(/not installed/i);
  });

  it("handles generic failure with non-zero exit", async () => {
    vi.doMock("./exec.js", () => ({
      runCommandWithTimeout: vi.fn(),
    }));

    const { checkDocker } = await import("./docker.js");
    const { runCommandWithTimeout } = await import("./exec.js");
    vi.mocked(runCommandWithTimeout).mockResolvedValueOnce({
      stdout: "",
      stderr: "some unexpected error",
      code: 1,
      signal: null,
      killed: false,
    });

    const result = await checkDocker();
    expect(result.available).toBe(false);
    expect(result.installed).toBe(true);
    expect(result.reason).toMatch(/docker returned an error/i);
  });

  it("handles non-ENOENT thrown error", async () => {
    vi.doMock("./exec.js", () => ({
      runCommandWithTimeout: vi.fn(),
    }));

    const { checkDocker } = await import("./docker.js");
    const { runCommandWithTimeout } = await import("./exec.js");
    vi.mocked(runCommandWithTimeout).mockRejectedValueOnce(new Error("timeout"));

    const result = await checkDocker();
    expect(result.available).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.reason).toMatch(/docker check failed/i);
  });
});
