import { beforeEach, describe, expect, it, vi } from "vitest";

const modelsStatusCommand = vi.fn().mockResolvedValue(undefined);

vi.mock("../commands/models.js", async () => {
  const actual =
    await vi.importActual<typeof import("../commands/models.js")>("../commands/models.js");

  return {
    ...actual,
    modelsStatusCommand,
  };
});

describe("models cli", () => {
  beforeEach(() => {
    modelsStatusCommand.mockClear();
  });

  // github-copilot login command was removed (provider stripped).

  it("passes --agent to models status", async () => {
    const { Command } = await import("commander");
    const { registerModelsCli } = await import("./models-cli.js");

    const program = new Command();
    registerModelsCli(program);

    await program.parseAsync(["models", "status", "--agent", "poe"], { from: "user" });

    expect(modelsStatusCommand).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "poe" }),
      expect.any(Object),
    );
  });

  it("passes parent --agent to models status", async () => {
    const { Command } = await import("commander");
    const { registerModelsCli } = await import("./models-cli.js");

    const program = new Command();
    registerModelsCli(program);

    await program.parseAsync(["models", "--agent", "poe", "status"], { from: "user" });

    expect(modelsStatusCommand).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "poe" }),
      expect.any(Object),
    );
  });

  it("shows help for models auth without error exit", async () => {
    const { Command } = await import("commander");
    const { registerModelsCli } = await import("./models-cli.js");

    const program = new Command();
    program.exitOverride();
    registerModelsCli(program);

    try {
      await program.parseAsync(["models", "auth"], { from: "user" });
      expect.fail("expected help to exit");
    } catch (err) {
      const error = err as { exitCode?: number };
      expect(error.exitCode).toBe(0);
    }
  });
});
