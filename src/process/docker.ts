import { runCommandWithTimeout } from "./exec.js";

export async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await runCommandWithTimeout(["docker", "info"], 10_000);
    return result.code === 0;
  } catch {
    return false;
  }
}
