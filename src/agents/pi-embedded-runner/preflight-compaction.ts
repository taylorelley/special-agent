import { estimateTokens, SessionManager } from "@mariozechner/pi-coding-agent";
import { SAFETY_MARGIN } from "../compaction.js";
import { log } from "./logger.js";

export const PROACTIVE_COMPACTION_THRESHOLD = 0.85;

export interface PreflightCompactionResult {
  shouldCompact: boolean;
  estimatedTokens: number;
  thresholdTokens: number;
}

/**
 * Proactive pre-flight check: estimates session token usage and returns
 * whether compaction should run before the next API attempt.
 *
 * This prevents hangs when providers don't return usage data (so the
 * reactive threshold never fires) or when the API times out on oversized
 * requests rather than returning a recognisable overflow error.
 *
 * Returns `shouldCompact: false` on any error — never blocks the run loop.
 */
export function checkPreflightCompaction(params: {
  sessionFile: string;
  contextWindowTokens: number;
  threshold?: number;
}): PreflightCompactionResult {
  const threshold = params.threshold ?? PROACTIVE_COMPACTION_THRESHOLD;
  const thresholdTokens = Math.floor(params.contextWindowTokens * threshold);
  const noCompact: PreflightCompactionResult = {
    shouldCompact: false,
    estimatedTokens: 0,
    thresholdTokens,
  };

  try {
    const sessionManager = SessionManager.open(params.sessionFile);
    const branch = sessionManager.getBranch();

    if (branch.length === 0) {
      return noCompact;
    }

    let estimatedTokens = 0;
    for (const entry of branch) {
      if (entry.type === "message") {
        estimatedTokens += estimateTokens(entry.message);
      }
    }

    // Apply safety margin to account for estimateTokens() inaccuracy
    estimatedTokens = Math.ceil(estimatedTokens * SAFETY_MARGIN);

    if (estimatedTokens >= thresholdTokens) {
      log.info(
        `[preflight-compaction] estimated=${estimatedTokens} threshold=${thresholdTokens} ` +
          `(${Math.round(threshold * 100)}% of ${params.contextWindowTokens}) — triggering proactive compaction`,
      );
      return { shouldCompact: true, estimatedTokens, thresholdTokens };
    }

    return { shouldCompact: false, estimatedTokens, thresholdTokens };
  } catch {
    // Missing/corrupt session file — don't block the run loop
    return noCompact;
  }
}
