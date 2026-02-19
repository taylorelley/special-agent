import { describe, expect, it } from "vitest";
import type { CronJob, CronJobPatch } from "./types.js";
import { computeNextRunAtMs } from "./schedule.js";
import { applyJobPatch, computeJobNextRunAtMs } from "./service/jobs.js";

describe("applyJobPatch", () => {
  it("clears delivery when switching to main session", () => {
    const now = Date.now();
    const job: CronJob = {
      id: "job-1",
      name: "job-1",
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "do it" },
      delivery: { mode: "announce", channel: "telegram", to: "123" },
      state: {},
    };

    const patch: CronJobPatch = {
      sessionTarget: "main",
      payload: { kind: "systemEvent", text: "ping" },
    };

    expect(() => applyJobPatch(job, patch)).not.toThrow();
    expect(job.sessionTarget).toBe("main");
    expect(job.payload.kind).toBe("systemEvent");
    expect(job.delivery).toBeUndefined();
  });

  it("maps legacy payload delivery updates onto delivery", () => {
    const now = Date.now();
    const job: CronJob = {
      id: "job-2",
      name: "job-2",
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "do it" },
      delivery: { mode: "announce", channel: "telegram", to: "123" },
      state: {},
    };

    const patch: CronJobPatch = {
      payload: {
        kind: "agentTurn",
        deliver: false,
        channel: "Signal",
        to: "555",
        bestEffortDeliver: true,
      },
    };

    expect(() => applyJobPatch(job, patch)).not.toThrow();
    expect(job.payload.kind).toBe("agentTurn");
    if (job.payload.kind === "agentTurn") {
      expect(job.payload.deliver).toBe(false);
      expect(job.payload.channel).toBe("Signal");
      expect(job.payload.to).toBe("555");
      expect(job.payload.bestEffortDeliver).toBe(true);
    }
    expect(job.delivery).toEqual({
      mode: "none",
      channel: "signal",
      to: "555",
      bestEffort: true,
    });
  });

  it("treats legacy payload targets as announce requests (delivery)", () => {
    const now = Date.now();
    const job: CronJob = {
      id: "job-3",
      name: "job-3",
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "do it" },
      delivery: { mode: "none", channel: "telegram" },
      state: {},
    };

    const patch: CronJobPatch = {
      payload: { kind: "agentTurn", to: " 999 " },
    };

    expect(() => applyJobPatch(job, patch)).not.toThrow();
    expect(job.delivery).toEqual({
      mode: "announce",
      channel: "telegram",
      to: "999",
      bestEffort: undefined,
    });
  });
});

describe("computeJobNextRunAtMs", () => {
  it("returns next run for a cron schedule with mid-second nowMs", () => {
    const noonMs = Date.parse("2026-02-08T12:00:00.000Z");
    // Use mid-second nowMs (500ms offset); the fallback path bumps to the
    // next second when computeNextRunAtMs returns undefined.
    const nowMs = noonMs + 500;
    const schedule = { kind: "cron" as const, expr: "0 0 12 * * *", tz: "UTC" };
    const job: CronJob = {
      id: "cron-1",
      name: "cron-1",
      enabled: true,
      createdAtMs: noonMs - 86_400_000,
      updatedAtMs: noonMs - 86_400_000,
      schedule,
      sessionTarget: "main",
      wakeMode: "now",
      payload: { kind: "systemEvent", text: "ping" },
      state: {},
    };

    const result = computeJobNextRunAtMs(job, nowMs);
    // Should equal the direct computeNextRunAtMs result (noon today).
    const expected = computeNextRunAtMs(schedule, nowMs);
    expect(result).toBe(expected);
    expect(result).toBe(noonMs);
  });

  it("returns undefined for disabled cron job", () => {
    const nowMs = Date.now();
    const job: CronJob = {
      id: "cron-2",
      name: "cron-2",
      enabled: false,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      schedule: { kind: "cron", expr: "0 0 12 * * *", tz: "UTC" },
      sessionTarget: "main",
      wakeMode: "now",
      payload: { kind: "systemEvent", text: "ping" },
      state: {},
    };

    expect(computeJobNextRunAtMs(job, nowMs)).toBeUndefined();
  });
});
