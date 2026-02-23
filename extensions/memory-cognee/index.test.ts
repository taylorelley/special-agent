/**
 * Memory (Cognee) Plugin Tests
 *
 * Tests plugin metadata, config resolution, and helper functions.
 * Live tests (requiring a running Cognee server) are gated behind
 * COGNEE_LIVE_TEST=1 env var.
 */

import { describe, test, expect } from "vitest";

// ---------------------------------------------------------------------------
// Mock API factory
// ---------------------------------------------------------------------------

function createMockApi(overrides: Record<string, unknown> = {}) {
  // oxlint-disable-next-line typescript/no-explicit-any
  const registeredClis: any[] = [];
  // oxlint-disable-next-line typescript/no-explicit-any
  const registeredServices: any[] = [];
  // oxlint-disable-next-line typescript/no-explicit-any
  const registeredHooks: Record<string, any[]> = {};
  // oxlint-disable-next-line typescript/no-explicit-any
  const registeredTools: any[] = [];

  const api = {
    id: "memory-cognee",
    name: "Memory (Cognee)",
    source: "test",
    config: {},
    pluginConfig: {
      baseUrl: "http://localhost:8000",
      autoRecall: true,
      autoIndex: true,
      ...overrides,
    },
    runtime: {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    // oxlint-disable-next-line typescript/no-explicit-any
    registerTool: (tool: any, opts: any) => {
      registeredTools.push({ tool, opts });
    },
    // oxlint-disable-next-line typescript/no-explicit-any
    registerCli: (registrar: any, opts: any) => {
      registeredClis.push({ registrar, opts });
    },
    // oxlint-disable-next-line typescript/no-explicit-any
    registerService: (service: any) => {
      registeredServices.push(service);
    },
    // oxlint-disable-next-line typescript/no-explicit-any
    on: (hookName: string, handler: any) => {
      if (!registeredHooks[hookName]) {
        registeredHooks[hookName] = [];
      }
      registeredHooks[hookName].push(handler);
    },
    resolvePath: (p: string) => p,
  };

  return { api, registeredClis, registeredServices, registeredHooks, registeredTools };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("memory-cognee plugin", () => {
  test("plugin has correct metadata", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.id).toBe("memory-cognee");
    expect(plugin.name).toBe("Memory (Cognee)");
    expect(plugin.kind).toBe("memory");
    // oxlint-disable-next-line typescript/unbound-method
    expect(plugin.register).toBeInstanceOf(Function);
  });

  test("plugin registers CLI, service, and hooks with mock API", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, registeredClis, registeredServices, registeredHooks } = createMockApi();

    // oxlint-disable-next-line typescript/no-explicit-any
    plugin.register(api as any);

    // CLI: cognee index + cognee status
    expect(registeredClis.length).toBe(1);
    expect(registeredClis[0].opts?.commands).toContain("cognee");

    // Service: cognee-auto-sync
    expect(registeredServices.length).toBe(1);
    expect(registeredServices[0].id).toBe("cognee-auto-sync");

    // Hooks: before_agent_start + agent_end
    expect(registeredHooks.before_agent_start).toBeDefined();
    expect(registeredHooks.before_agent_start.length).toBe(1);
    expect(registeredHooks.agent_end).toBeDefined();
    expect(registeredHooks.agent_end.length).toBe(1);
  });

  test("plugin skips hooks when autoRecall/autoIndex are false", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, registeredServices, registeredHooks } = createMockApi({
      autoRecall: false,
      autoIndex: false,
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    plugin.register(api as any);

    // No service when autoIndex is false
    expect(registeredServices.length).toBe(0);

    // No hooks when both are false
    expect(registeredHooks.before_agent_start ?? []).toHaveLength(0);
    expect(registeredHooks.agent_end ?? []).toHaveLength(0);
  });

  test("plugin registers tools when enableTools is true (default)", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, registeredTools } = createMockApi({
      autoRecall: false,
      autoIndex: false,
      enableTools: true,
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    plugin.register(api as any);

    expect(registeredTools.length).toBe(3);
    const toolNames = registeredTools.map(
      // oxlint-disable-next-line typescript/no-explicit-any
      (t: any) => t.opts?.name,
    );
    expect(toolNames).toContain("memory_recall");
    expect(toolNames).toContain("memory_store");
    expect(toolNames).toContain("memory_forget");
  });

  test("plugin skips tools when enableTools is false", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, registeredTools } = createMockApi({
      autoRecall: false,
      autoIndex: false,
      enableTools: false,
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    plugin.register(api as any);

    expect(registeredTools.length).toBe(0);
  });

  test("plugin registers agent_end hook when consolidation is enabled (autoIndex off)", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, registeredHooks } = createMockApi({
      autoRecall: false,
      autoIndex: false,
      enableTools: false,
      consolidationEnabled: true,
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    plugin.register(api as any);

    // agent_end hook registered for consolidation even when autoIndex is false
    expect(registeredHooks.agent_end).toBeDefined();
    expect(registeredHooks.agent_end.length).toBe(1);
  });

  test("plugin does not register agent_end hook when consolidation and autoIndex are both off", async () => {
    const { default: plugin } = await import("./index.js");
    const { api, registeredHooks } = createMockApi({
      autoRecall: false,
      autoIndex: false,
      enableTools: false,
      consolidationEnabled: false,
      reflectionEnabled: false,
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    plugin.register(api as any);

    // No agent_end hook when both autoIndex and consolidation are off
    expect(registeredHooks.agent_end ?? []).toHaveLength(0);
  });
});
