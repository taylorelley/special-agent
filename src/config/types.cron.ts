export type CronRetryOn = "rate_limit" | "network" | "timeout" | "server_error";

export type CronConfig = {
  enabled?: boolean;
  store?: string;
  maxConcurrentRuns?: number;
  /**
   * How long to retain completed cron run sessions before automatic pruning.
   * Accepts a duration string (e.g. "24h", "7d", "1h30m") or `false` to disable pruning.
   * Default: "24h".
   */
  sessionRetention?: string | false;
  /** Retry policy for one-shot jobs on transient errors. */
  retry?: {
    maxAttempts?: number;
    backoffMs?: number[];
    retryOn?: CronRetryOn[];
  };
  /** Global failure alert config (can be overridden per-job). */
  failureAlert?: {
    enabled?: boolean;
    after?: number;
    cooldownMs?: number;
  };
};
