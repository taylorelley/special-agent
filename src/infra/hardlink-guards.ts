import fs from "node:fs/promises";
import { shortPath } from "../utils/short-path.js";
import { isNotFoundPathError } from "./path-guards.js";

export async function assertNoHardlinkedFinalPath(params: {
  filePath: string;
  root: string;
  boundaryLabel: string;
  allowFinalHardlinkForUnlink?: boolean;
}): Promise<void> {
  if (params.allowFinalHardlinkForUnlink) {
    return;
  }
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(params.filePath);
  } catch (err) {
    if (isNotFoundPathError(err)) {
      return;
    }
    throw err;
  }
  if (!stat.isFile()) {
    return;
  }
  if (stat.nlink > 1) {
    throw new Error(
      `Hardlinked path is not allowed under ${params.boundaryLabel} (${shortPath(params.root)}): ${shortPath(params.filePath)}`,
    );
  }
}
