import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MsgContext } from "../auto-reply/templating.js";
import type { SpecialAgentConfig } from "../config/config.js";
import {
  buildProviderRegistry,
  createMediaAttachmentCache,
  normalizeMediaAttachments,
  runCapability,
} from "./runner.js";

describe("runCapability auto audio entries", () => {
  it("skips auto audio when disabled", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    const tmpPath = path.join(os.tmpdir(), `special-agent-auto-audio-${Date.now()}.wav`);
    await fs.writeFile(tmpPath, Buffer.from("RIFF"));
    const ctx: MsgContext = { MediaPath: tmpPath, MediaType: "audio/wav" };
    const media = normalizeMediaAttachments(ctx);
    const cache = createMediaAttachmentCache(media);

    const providerRegistry = buildProviderRegistry({
      openai: {
        id: "openai",
        capabilities: ["audio"],
        transcribeAudio: async () => ({ text: "ok", model: "whisper-1" }),
      },
    });

    const cfg = {
      models: {
        providers: {
          openai: {
            apiKey: "test-key",
            models: [],
          },
        },
      },
      tools: {
        media: {
          audio: {
            enabled: false,
          },
        },
      },
    } as unknown as SpecialAgentConfig;

    try {
      const result = await runCapability({
        capability: "audio",
        cfg,
        ctx,
        attachments: cache,
        media,
        providerRegistry,
      });
      expect(result.outputs).toHaveLength(0);
      expect(result.decision.outcome).toBe("disabled");
    } finally {
      process.env.PATH = originalPath;
      await cache.cleanup();
      await fs.unlink(tmpPath).catch(() => {});
    }
  });
});
