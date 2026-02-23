import { runCommandWithTimeout } from "./exec.js";

export type DockerStatus = {
  available: boolean;
  installed: boolean;
  reason?: string;
};

export async function checkDocker(): Promise<DockerStatus> {
  try {
    const result = await runCommandWithTimeout(["docker", "info"], 10_000);
    if (result.code === 0) {
      return { available: true, installed: true };
    }
    const stderr = result.stderr.toLowerCase();
    if (stderr.includes("permission denied")) {
      return {
        available: false,
        installed: true,
        reason: "Permission denied. Add your user to the docker group or run with sudo.",
      };
    }
    if (
      stderr.includes("is the docker daemon running") ||
      stderr.includes("cannot connect") ||
      stderr.includes("connection refused")
    ) {
      return {
        available: false,
        installed: true,
        reason: "Docker daemon is not running. Start the Docker service and try again.",
      };
    }
    return {
      available: false,
      installed: true,
      reason: `Docker returned an error: ${result.stderr.trim().split("\n")[0]}`,
    };
  } catch (err) {
    const message = String((err as NodeJS.ErrnoException)?.code ?? err);
    if (message === "ENOENT") {
      return {
        available: false,
        installed: false,
        reason: "Docker is not installed.",
      };
    }
    return {
      available: false,
      installed: false,
      reason: `Docker check failed: ${message}`,
    };
  }
}
