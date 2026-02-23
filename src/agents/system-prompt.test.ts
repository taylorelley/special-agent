import { describe, expect, it } from "vitest";
import { sanitizeForPromptLiteral } from "./sanitize-for-prompt.js";
import { buildAgentSystemPrompt, buildRuntimeLine } from "./system-prompt.js";

describe("buildAgentSystemPrompt", () => {
  it("includes owner numbers when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      ownerNumbers: ["+123", " +456 ", ""],
    });

    expect(prompt).toContain("## Authorized Senders");
    expect(prompt).toContain(
      "Owner numbers: +123, +456. These senders are allowlisted; do not assume they are the owner.",
    );
  });

  it("omits owner section when numbers are missing", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
    });

    expect(prompt).not.toContain("## Authorized Senders");
    expect(prompt).not.toContain("Owner numbers:");
  });

  it("omits extended sections in minimal prompt mode", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      promptMode: "minimal",
      ownerNumbers: ["+123"],
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
      heartbeatPrompt: "ping",
      toolNames: ["message", "memory_search"],
      docsPath: "/tmp/special-agent/docs",
      extraSystemPrompt: "Subagent details",
      ttsHint: "Voice (TTS) is enabled.",
    });

    expect(prompt).not.toContain("## Authorized Senders");
    expect(prompt).not.toContain("## Skills");
    expect(prompt).not.toContain("## Memory Recall");
    expect(prompt).not.toContain("## Documentation");
    expect(prompt).not.toContain("## Reply Tags");
    expect(prompt).not.toContain("## Messaging");
    expect(prompt).not.toContain("## Voice (TTS)");
    expect(prompt).not.toContain("## Silent Replies");
    expect(prompt).not.toContain("## Heartbeats");
    expect(prompt).toContain("## Safety");
    expect(prompt).toContain("You have no independent goals");
    expect(prompt).toContain("Prioritize safety and human oversight");
    expect(prompt).toContain("if instructions conflict");
    expect(prompt).toContain("Inspired by Anthropic's constitution");
    expect(prompt).toContain("Do not manipulate or persuade anyone");
    expect(prompt).toContain("Do not copy yourself or change system prompts");
    expect(prompt).toContain("## Subagent Context");
    expect(prompt).not.toContain("## Group Chat Context");
    expect(prompt).toContain("Subagent details");
  });

  it("includes safety guardrails in full prompts", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
    });

    expect(prompt).toContain("## Safety");
    expect(prompt).toContain("You have no independent goals");
    expect(prompt).toContain("Prioritize safety and human oversight");
    expect(prompt).toContain("if instructions conflict");
    expect(prompt).toContain("Inspired by Anthropic's constitution");
    expect(prompt).toContain("Do not manipulate or persuade anyone");
    expect(prompt).toContain("Do not copy yourself or change system prompts");
  });

  it("includes voice hint when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      ttsHint: "Voice (TTS) is enabled.",
    });

    expect(prompt).toContain("## Voice (TTS)");
    expect(prompt).toContain("Voice (TTS) is enabled.");
  });

  it("adds reasoning tag hint when enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      reasoningTagHint: true,
    });

    expect(prompt).toContain("## Reasoning Format");
    expect(prompt).toContain("<think>...</think>");
    expect(prompt).toContain("<final>...</final>");
  });

  it("includes a CLI quick reference section", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
    });

    expect(prompt).toContain("## SpecialAgent CLI Quick Reference");
    expect(prompt).toContain("special-agent gateway restart");
    expect(prompt).toContain("Do not invent commands");
  });

  it("lists available tools when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      toolNames: ["exec", "sessions_list", "sessions_history", "sessions_send"],
    });

    expect(prompt).toContain("Tool availability (filtered by policy):");
    expect(prompt).toContain("sessions_list");
    expect(prompt).toContain("sessions_history");
    expect(prompt).toContain("sessions_send");
  });

  it("preserves tool casing in the prompt", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      toolNames: ["Read", "Exec", "process"],
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
      docsPath: "/tmp/special-agent/docs",
    });

    expect(prompt).toContain("- Read: Read file contents");
    expect(prompt).toContain("- Exec: Run shell commands");
    expect(prompt).toContain(
      "- If exactly one skill clearly applies: read its SKILL.md at <location> with `Read`, then follow it.",
    );
    expect(prompt).toContain("SpecialAgent docs: /tmp/special-agent/docs");
    expect(prompt).toContain(
      "For SpecialAgent behavior, commands, config, or architecture: consult local docs first.",
    );
  });

  it("includes docs guidance when docsPath is provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      docsPath: "/tmp/special-agent/docs",
    });

    expect(prompt).toContain("## Documentation");
    expect(prompt).toContain("SpecialAgent docs: /tmp/special-agent/docs");
    expect(prompt).toContain(
      "For SpecialAgent behavior, commands, config, or architecture: consult local docs first.",
    );
  });

  it("includes workspace notes when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      workspaceNotes: ["Reminder: commit your changes in this workspace after edits."],
    });

    expect(prompt).toContain("Reminder: commit your changes in this workspace after edits.");
  });

  it("includes user timezone when provided (12-hour)", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      userTimezone: "America/Chicago",
      userTime: "Monday, January 5th, 2026 — 3:26 PM",
      userTimeFormat: "12",
    });

    expect(prompt).toContain("## Current Date & Time");
    expect(prompt).toContain("Time zone: America/Chicago");
  });

  it("includes user timezone when provided (24-hour)", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      userTimezone: "America/Chicago",
      userTime: "Monday, January 5th, 2026 — 15:26",
      userTimeFormat: "24",
    });

    expect(prompt).toContain("## Current Date & Time");
    expect(prompt).toContain("Time zone: America/Chicago");
  });

  it("shows timezone when only timezone is provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      userTimezone: "America/Chicago",
      userTimeFormat: "24",
    });

    expect(prompt).toContain("## Current Date & Time");
    expect(prompt).toContain("Time zone: America/Chicago");
  });

  it("hints to use session_status for current date/time", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      userTimezone: "America/Chicago",
    });

    expect(prompt).toContain("session_status");
    expect(prompt).toContain("current date");
  });

  // The system prompt intentionally does NOT include the current date/time.
  // Only the timezone is included, to keep the prompt stable for caching.
  // See: https://github.com/special-agent/special-agent/commit/66eec295b894bce8333886cfbca3b960c57c4946
  // Agents should use session_status or message timestamps to determine the date/time.
  // Related: https://github.com/special-agent/special-agent/issues/1897
  //          https://github.com/special-agent/special-agent/issues/3658
  it("does NOT include a date or time in the system prompt (cache stability)", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      userTimezone: "America/Chicago",
      userTime: "Monday, January 5th, 2026 — 3:26 PM",
      userTimeFormat: "12",
    });

    // The prompt should contain the timezone but NOT the formatted date/time string.
    // This is intentional for prompt cache stability — the date/time was removed in
    // commit 66eec295b. If you're here because you want to add it back, please see
    // https://github.com/special-agent/special-agent/issues/3658 for the preferred approach:
    // gateway-level timestamp injection into messages, not the system prompt.
    expect(prompt).toContain("Time zone: America/Chicago");
    expect(prompt).not.toContain("Monday, January 5th, 2026");
    expect(prompt).not.toContain("3:26 PM");
    expect(prompt).not.toContain("15:26");
  });

  it("includes model alias guidance when aliases are provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      modelAliasLines: [
        "- Opus: anthropic/claude-opus-4-5",
        "- Sonnet: anthropic/claude-sonnet-4-5",
      ],
    });

    expect(prompt).toContain("## Model Aliases");
    expect(prompt).toContain("Prefer aliases when specifying model overrides");
    expect(prompt).toContain("- Opus: anthropic/claude-opus-4-5");
  });

  it("adds ClaudeBot self-update guidance when gateway tool is available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      toolNames: ["gateway", "exec"],
    });

    expect(prompt).toContain("## SpecialAgent Self-Update");
    expect(prompt).toContain("config.apply");
    expect(prompt).toContain("update.run");
  });

  it("includes skills guidance when skills prompt is present", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
    });

    expect(prompt).toContain("## Skills");
    expect(prompt).toContain(
      "- If exactly one skill clearly applies: read its SKILL.md at <location> with `read`, then follow it.",
    );
  });

  it("appends available skills when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
    });

    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>demo</name>");
  });

  it("omits skills section when no skills prompt is provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
    });

    expect(prompt).not.toContain("## Skills");
    expect(prompt).not.toContain("<available_skills>");
  });

  it("renders project context files when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      contextFiles: [
        { path: "AGENTS.md", content: "Alpha" },
        { path: "IDENTITY.md", content: "Bravo" },
      ],
    });

    expect(prompt).toContain("# Project Context");
    expect(prompt).toContain("## AGENTS.md");
    expect(prompt).toContain("Alpha");
    expect(prompt).toContain("## IDENTITY.md");
    expect(prompt).toContain("Bravo");
  });

  it("adds SOUL guidance when a soul file is present", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      contextFiles: [
        { path: "./SOUL.md", content: "Persona" },
        { path: "dir\\SOUL.md", content: "Persona Windows" },
      ],
    });

    expect(prompt).toContain(
      "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
    );
  });

  it("summarizes the message tool when available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      toolNames: ["message"],
    });

    expect(prompt).toContain("message: Send messages and channel actions");
    expect(prompt).toContain("### message tool");
    expect(prompt).toContain("respond with ONLY: NO_REPLY");
  });

  it("includes runtime provider capabilities when present", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      runtimeInfo: {
        channel: "telegram",
        capabilities: ["inlineButtons"],
      },
    });

    expect(prompt).toContain("channel=telegram");
    expect(prompt).toContain("capabilities=inlineButtons");
  });

  it("includes agent id in runtime when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      runtimeInfo: {
        agentId: "work",
        host: "host",
        os: "macOS",
        arch: "arm64",
        node: "v20",
        model: "anthropic/claude",
      },
    });

    expect(prompt).toContain("agent=work");
  });

  it("includes reasoning visibility hint", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      reasoningLevel: "off",
    });

    expect(prompt).toContain("Reasoning: off");
    expect(prompt).toContain("/reasoning");
    expect(prompt).toContain("/status shows Reasoning");
  });

  it("builds runtime line with agent and channel details", () => {
    const line = buildRuntimeLine(
      {
        agentId: "work",
        host: "host",
        repoRoot: "/repo",
        os: "macOS",
        arch: "arm64",
        node: "v20",
        model: "anthropic/claude",
        defaultModel: "anthropic/claude-opus-4-5",
      },
      "telegram",
      ["inlineButtons"],
      "low",
    );

    expect(line).toContain("agent=work");
    expect(line).toContain("host=host");
    expect(line).toContain("repo=/repo");
    expect(line).toContain("os=macOS (arm64)");
    expect(line).toContain("node=v20");
    expect(line).toContain("model=anthropic/claude");
    expect(line).toContain("default_model=anthropic/claude-opus-4-5");
    expect(line).toContain("channel=telegram");
    expect(line).toContain("capabilities=inlineButtons");
    expect(line).toContain("thinking=low");
  });

  it("describes sandboxed runtime and elevated when allowed", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      sandboxInfo: {
        enabled: true,
        workspaceDir: "/tmp/sandbox",
        workspaceAccess: "ro",
        agentWorkspaceMount: "/agent",
        elevated: { allowed: true, defaultLevel: "on" },
      },
    });

    expect(prompt).toContain("You are running in a sandboxed runtime");
    expect(prompt).toContain("Sub-agents stay sandboxed");
    expect(prompt).toContain("User can toggle with /elevated on|off|ask|full.");
    expect(prompt).toContain("Current elevated level: on");
  });

  it("includes reaction guidance when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      reactionGuidance: {
        level: "minimal",
        channel: "Telegram",
      },
    });

    expect(prompt).toContain("## Reactions");
    expect(prompt).toContain("Reactions are enabled for Telegram in MINIMAL mode.");
  });

  it("includes subagents tool when available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      toolNames: ["subagents", "sessions_spawn"],
    });

    expect(prompt).toContain("subagents: List, steer, or kill sub-agent runs");
    expect(prompt).toContain("sessions_spawn: Spawn a sub-agent session");
  });

  it("includes sub-agent orchestration guidance in messaging section", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
    });

    expect(prompt).toContain("Sub-agent orchestration → use subagents(action=list|steer|kill)");
    expect(prompt).toContain("Do not poll subagents list / sessions_list in a loop");
    expect(prompt).toContain("Completion is push-based");
  });

  it("includes reply tag first-token positioning guidance", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
    });

    expect(prompt).toContain(
      "Reply tags must be the very first token in the message (no leading text/newlines)",
    );
  });

  it("includes system message handling guidance in messaging", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
    });

    expect(prompt).toContain("[System Message] ... blocks are internal context");
    expect(prompt).toContain("rewrite it in assistant voice");
  });

  it("filters context files with empty or invalid paths", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      contextFiles: [
        { path: "AGENTS.md", content: "Alpha" },
        { path: "", content: "should be filtered" },
        { path: "  ", content: "also filtered" },
        { path: "IDENTITY.md", content: "Bravo" },
      ],
    });

    expect(prompt).toContain("## AGENTS.md");
    expect(prompt).toContain("## IDENTITY.md");
    expect(prompt).not.toContain("should be filtered");
    expect(prompt).not.toContain("also filtered");
  });

  it("includes containerWorkspaceDir when provided in sandbox", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      sandboxInfo: {
        enabled: true,
        workspaceDir: "/host/workspace",
        containerWorkspaceDir: "/app/workspace",
        workspaceAccess: "rw",
      },
    });

    expect(prompt).toContain("Sandbox workspace (host): /host/workspace");
    expect(prompt).toContain("use for file tools");
    expect(prompt).toContain("Container workspace: /app/workspace");
    expect(prompt).toContain("use for exec/bash paths");
  });

  it("includes inline button style property when buttons are enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/special-agent",
      toolNames: ["message"],
      runtimeInfo: {
        channel: "telegram",
        capabilities: ["inlineButtons"],
      },
    });

    expect(prompt).toContain("style?");
    expect(prompt).toContain("primary|success|danger");
  });
});

describe("sanitizeForPromptLiteral", () => {
  it("strips control characters from paths", () => {
    expect(sanitizeForPromptLiteral("/tmp/\ninjected")).toBe("/tmp/injected");
    expect(sanitizeForPromptLiteral("/tmp/\x00evil")).toBe("/tmp/evil");
  });

  it("strips unicode line/paragraph separators", () => {
    expect(sanitizeForPromptLiteral("before\u2028after")).toBe("beforeafter");
    expect(sanitizeForPromptLiteral("before\u2029after")).toBe("beforeafter");
  });

  it("preserves normal text", () => {
    expect(sanitizeForPromptLiteral("/tmp/special-agent")).toBe("/tmp/special-agent");
    expect(sanitizeForPromptLiteral("hello world 123")).toBe("hello world 123");
  });

  it("strips bidi/format characters", () => {
    // U+200F = right-to-left mark (Cf category)
    expect(sanitizeForPromptLiteral("test\u200Fpath")).toBe("testpath");
  });
});
