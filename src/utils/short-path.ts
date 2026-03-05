import os from "node:os";
import path from "node:path";

export function shortPath(value: string): string {
  const home = os.homedir();
  if (value === home || value.startsWith(home + path.sep)) {
    return `~${value.slice(home.length)}`;
  }
  return value;
}
