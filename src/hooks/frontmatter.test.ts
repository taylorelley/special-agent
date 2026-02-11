import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  resolveSpecialAgentMetadata,
  resolveHookInvocationPolicy,
} from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses single-line key-value pairs", () => {
    const content = `---
name: test-hook
description: "A test hook"
homepage: https://example.com
---

# Test Hook
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("test-hook");
    expect(result.description).toBe("A test hook");
    expect(result.homepage).toBe("https://example.com");
  });

  it("handles missing frontmatter", () => {
    const content = "# Just a markdown file";
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it("handles unclosed frontmatter", () => {
    const content = `---
name: broken
`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({});
  });

  it("parses multi-line metadata block with indented JSON", () => {
    const content = `---
name: session-memory
description: "Save session context"
metadata:
  {
    "special-agent": {
      "emoji": "💾",
      "events": ["command:new"]
    }
  }
---

# Session Memory Hook
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("session-memory");
    expect(result.description).toBe("Save session context");
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata).toBe("string");

    // Verify the metadata is valid JSON
    const parsed = JSON.parse(result.metadata);
    expect(parsed.special - agent.emoji).toBe("💾");
    expect(parsed.special - agent.events).toEqual(["command:new"]);
  });

  it("parses multi-line metadata with complex nested structure", () => {
    const content = `---
name: command-logger
description: "Log all command events"
metadata:
  {
    "special-agent":
      {
        "emoji": "📝",
        "events": ["command"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled" }]
      }
  }
---
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("command-logger");
    expect(result.metadata).toBeDefined();

    const parsed = JSON.parse(result.metadata);
    expect(parsed.special - agent.emoji).toBe("📝");
    expect(parsed.special - agent.events).toEqual(["command"]);
    expect(parsed.special - agent.requires.config).toEqual(["workspace.dir"]);
    expect(parsed.special - agent.install[0].kind).toBe("bundled");
  });

  it("handles single-line metadata (inline JSON)", () => {
    const content = `---
name: simple-hook
metadata: {"special-agent": {"events": ["test"]}}
---
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("simple-hook");
    expect(result.metadata).toBe('{"special-agent": {"events": ["test"]}}');
  });

  it("handles mixed single-line and multi-line values", () => {
    const content = `---
name: mixed-hook
description: "A hook with mixed values"
homepage: https://example.com
metadata:
  {
    "special-agent": {
      "events": ["command:new"]
    }
  }
enabled: true
---
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("mixed-hook");
    expect(result.description).toBe("A hook with mixed values");
    expect(result.homepage).toBe("https://example.com");
    expect(result.metadata).toBeDefined();
    expect(result.enabled).toBe("true");
  });

  it("strips surrounding quotes from values", () => {
    const content = `---
name: "quoted-name"
description: 'single-quoted'
---
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("quoted-name");
    expect(result.description).toBe("single-quoted");
  });

  it("handles CRLF line endings", () => {
    const content = "---\r\nname: test\r\ndescription: crlf\r\n---\r\n";
    const result = parseFrontmatter(content);
    expect(result.name).toBe("test");
    expect(result.description).toBe("crlf");
  });

  it("handles CR line endings", () => {
    const content = "---\rname: test\rdescription: cr\r---\r";
    const result = parseFrontmatter(content);
    expect(result.name).toBe("test");
    expect(result.description).toBe("cr");
  });
});

describe("resolveSpecialAgentMetadata", () => {
  it("extracts special-agent metadata from parsed frontmatter", () => {
    const frontmatter = {
      name: "test-hook",
      metadata: JSON.stringify({
        "special-agent": {
          emoji: "🔥",
          events: ["command:new", "command:reset"],
          requires: {
            config: ["workspace.dir"],
            bins: ["git"],
          },
        },
      }),
    };

    const result = resolveSpecialAgentMetadata(frontmatter);
    expect(result).toBeDefined();
    expect(result?.emoji).toBe("🔥");
    expect(result?.events).toEqual(["command:new", "command:reset"]);
    expect(result?.requires?.config).toEqual(["workspace.dir"]);
    expect(result?.requires?.bins).toEqual(["git"]);
  });

  it("returns undefined when metadata is missing", () => {
    const frontmatter = { name: "no-metadata" };
    const result = resolveSpecialAgentMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("returns undefined when special-agent key is missing", () => {
    const frontmatter = {
      metadata: JSON.stringify({ other: "data" }),
    };
    const result = resolveSpecialAgentMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    const frontmatter = {
      metadata: "not valid json {",
    };
    const result = resolveSpecialAgentMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("handles install specs", () => {
    const frontmatter = {
      metadata: JSON.stringify({
        "special-agent": {
          events: ["command"],
          install: [
            { id: "bundled", kind: "bundled", label: "Bundled with SpecialAgent" },
            { id: "npm", kind: "npm", package: "@special-agent/hook" },
          ],
        },
      }),
    };

    const result = resolveSpecialAgentMetadata(frontmatter);
    expect(result?.install).toHaveLength(2);
    expect(result?.install?.[0].kind).toBe("bundled");
    expect(result?.install?.[1].kind).toBe("npm");
    expect(result?.install?.[1].package).toBe("@special-agent/hook");
  });

  it("handles os restrictions", () => {
    const frontmatter = {
      metadata: JSON.stringify({
        "special-agent": {
          events: ["command"],
          os: ["darwin", "linux"],
        },
      }),
    };

    const result = resolveSpecialAgentMetadata(frontmatter);
    expect(result?.os).toEqual(["darwin", "linux"]);
  });

  it("parses real session-memory HOOK.md format", () => {
    // This is the actual format used in the bundled hooks
    const content = `---
name: session-memory
description: "Save session context to memory when /new command is issued"
homepage: https://docs.special-agent.ai/hooks#session-memory
metadata:
  {
    "special-agent":
      {
        "emoji": "💾",
        "events": ["command:new"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with SpecialAgent" }],
      },
  }
---

# Session Memory Hook
`;

    const frontmatter = parseFrontmatter(content);
    expect(frontmatter.name).toBe("session-memory");
    expect(frontmatter.metadata).toBeDefined();

    const specialAgent = resolveSpecialAgentMetadata(frontmatter);
    expect(specialAgent).toBeDefined();
    expect(specialAgent?.emoji).toBe("💾");
    expect(specialAgent?.events).toEqual(["command:new"]);
    expect(specialAgent?.requires?.config).toEqual(["workspace.dir"]);
    expect(specialAgent?.install?.[0].kind).toBe("bundled");
  });

  it("parses YAML metadata map", () => {
    const content = `---
name: yaml-metadata
metadata:
  "special-agent":
    emoji: disk
    events:
      - command:new
---
`;
    const frontmatter = parseFrontmatter(content);
    const specialAgent = resolveSpecialAgentMetadata(frontmatter);
    expect(specialAgent?.emoji).toBe("disk");
    expect(specialAgent?.events).toEqual(["command:new"]);
  });
});

describe("resolveHookInvocationPolicy", () => {
  it("defaults to enabled when missing", () => {
    expect(resolveHookInvocationPolicy({}).enabled).toBe(true);
  });

  it("parses enabled flag", () => {
    expect(resolveHookInvocationPolicy({ enabled: "no" }).enabled).toBe(false);
    expect(resolveHookInvocationPolicy({ enabled: "on" }).enabled).toBe(true);
  });
});
