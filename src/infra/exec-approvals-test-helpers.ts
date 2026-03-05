import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makePathEnv(binDir: string): NodeJS.ProcessEnv {
  if (process.platform !== "win32") {
    return { PATH: binDir };
  }
  return { PATH: binDir, PATHEXT: ".EXE;.CMD;.BAT;.COM" };
}

export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "special-agent-exec-approvals-"));
}
