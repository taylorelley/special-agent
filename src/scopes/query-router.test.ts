import { describe, expect, it } from "vitest";
import type { CogneeSearchResult } from "../../extensions/memory-cognee/client.js";
import type { SearchExecutor, ScopedQueryParams } from "./query-router.js";
import type { ScopeContext } from "./types.js";
import { queryScopedKnowledge } from "./query-router.js";

function makeExecutor(responses: Map<string, CogneeSearchResult[]>): SearchExecutor {
  return {
    async search(params: Parameters<SearchExecutor["search"]>[0]) {
      expect(params.datasetIds).toHaveLength(1);
      const datasetId = params.datasetIds[0];
      return responses.get(datasetId) ?? [];
    },
  };
}

function makeParams(
  overrides: Partial<ScopedQueryParams> & { scope: ScopeContext },
): ScopedQueryParams {
  return {
    query: "test query",
    searchType: "GRAPH_COMPLETION",
    topK: 10,
    maxResults: 10,
    minScore: 0,
    datasetIdMap: new Map(),
    executor: makeExecutor(new Map()),
    ...overrides,
  };
}

describe("queryScopedKnowledge", () => {
  it("returns empty when no dataset IDs are mapped", async () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const result = await queryScopedKnowledge(makeParams({ scope, datasetIdMap: new Map() }));
    expect(result.results).toEqual([]);
    expect(result.datasetsQueried).toBe(0);
  });

  it("queries personal private and profile datasets in 1:1 personal scope", async () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const datasetIdMap = new Map([
      ["alice-private", "id-private"],
      ["alice-profile", "id-profile"],
    ]);
    const responses = new Map<string, CogneeSearchResult[]>([
      ["id-private", [{ id: "r1", text: "private note", score: 0.9 }]],
      ["id-profile", [{ id: "r2", text: "profile pref", score: 0.8 }]],
    ]);

    const result = await queryScopedKnowledge(
      makeParams({
        scope,
        datasetIdMap,
        executor: makeExecutor(responses),
      }),
    );

    expect(result.datasetsQueried).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].id).toBe("r1"); // Higher score first
    expect(result.results[0].sourceTier).toBe("personal");
    expect(result.results[1].id).toBe("r2");
  });

  it("includes project and team datasets in project scope", async () => {
    const scope: ScopeContext = {
      tier: "project",
      project: { id: "webapp", name: "Web App" },
      userId: "alice",
      isGroupSession: false,
    };
    const datasetIdMap = new Map([
      ["alice-private", "id-private"],
      ["alice-profile", "id-profile"],
      ["project-webapp", "id-project"],
      ["team-shared", "id-team"],
    ]);
    const responses = new Map<string, CogneeSearchResult[]>([
      ["id-private", [{ id: "r1", text: "private", score: 0.5 }]],
      ["id-profile", [{ id: "r2", text: "profile", score: 0.6 }]],
      ["id-project", [{ id: "r3", text: "project arch", score: 0.95 }]],
      ["id-team", [{ id: "r4", text: "team standard", score: 0.7 }]],
    ]);

    const result = await queryScopedKnowledge(
      makeParams({
        scope,
        datasetIdMap,
        executor: makeExecutor(responses),
      }),
    );

    expect(result.datasetsQueried).toBe(4);
    expect(result.results).toHaveLength(4);
    expect(result.results[0].sourceDataset).toBe("project-webapp");
  });

  it("filters private results in group sessions", async () => {
    const scope: ScopeContext = {
      tier: "project",
      project: { id: "webapp", name: "Web App" },
      userId: "alice",
      isGroupSession: true,
    };
    // In group session, private is not queried by resolveRecallDatasets
    const datasetIdMap = new Map([
      ["alice-profile", "id-profile"],
      ["project-webapp", "id-project"],
      ["team-shared", "id-team"],
    ]);
    const responses = new Map<string, CogneeSearchResult[]>([
      ["id-profile", [{ id: "r1", text: "profile", score: 0.8 }]],
      ["id-project", [{ id: "r2", text: "project", score: 0.9 }]],
      ["id-team", [{ id: "r3", text: "team", score: 0.7 }]],
    ]);

    const result = await queryScopedKnowledge(
      makeParams({
        scope,
        datasetIdMap,
        executor: makeExecutor(responses),
      }),
    );

    // Private dataset is not even queried in group sessions (pre-query exclusion)
    expect(result.datasetsQueried).toBe(3);
    expect(result.totalBeforeFilter).toBe(3);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.sourceDataset !== "alice-private")).toBe(true);
  });

  it("deduplicates results with identical text", async () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const datasetIdMap = new Map([
      ["alice-private", "id-private"],
      ["alice-profile", "id-profile"],
    ]);
    const responses = new Map<string, CogneeSearchResult[]>([
      ["id-private", [{ id: "r1", text: "same content", score: 0.9 }]],
      ["id-profile", [{ id: "r2", text: "same content", score: 0.8 }]],
    ]);

    const result = await queryScopedKnowledge(
      makeParams({
        scope,
        datasetIdMap,
        executor: makeExecutor(responses),
      }),
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("r1"); // Higher score wins
  });

  it("respects minScore threshold", async () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const datasetIdMap = new Map([["alice-private", "id-private"]]);
    const responses = new Map<string, CogneeSearchResult[]>([
      [
        "id-private",
        [
          { id: "r1", text: "high score", score: 0.9 },
          { id: "r2", text: "low score", score: 0.1 },
        ],
      ],
    ]);

    const result = await queryScopedKnowledge(
      makeParams({
        scope,
        datasetIdMap,
        executor: makeExecutor(responses),
        minScore: 0.5,
      }),
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("r1");
    expect(result.totalBeforeFilter).toBe(2); // Both results fetched, one filtered by minScore
  });

  it("respects maxResults limit", async () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const datasetIdMap = new Map([["alice-private", "id-private"]]);
    const results: CogneeSearchResult[] = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      text: `result ${i}`,
      score: 1 - i * 0.01,
    }));
    const responses = new Map([["id-private", results]]);

    const result = await queryScopedKnowledge(
      makeParams({
        scope,
        datasetIdMap,
        executor: makeExecutor(responses),
        maxResults: 5,
      }),
    );

    expect(result.results).toHaveLength(5);
  });

  it("preserves non-private results through post-retrieval privacy filter in group sessions", async () => {
    // In a group session, resolveRecallDatasets excludes private datasets
    // at the pre-query stage. The post-retrieval privacy filter is a second
    // line of defense. This test verifies that non-private results with
    // known provenance survive the filter.
    const scope: ScopeContext = {
      tier: "project",
      project: { id: "webapp", name: "Web App" },
      userId: "alice",
      isGroupSession: true,
    };
    const datasetIdMap = new Map([
      ["alice-profile", "id-profile"],
      ["project-webapp", "id-project"],
    ]);
    const responses = new Map<string, CogneeSearchResult[]>([
      ["id-profile", [{ id: "r1", text: "profile data", score: 0.8 }]],
      ["id-project", [{ id: "r2", text: "project note", score: 0.9 }]],
    ]);

    const result = await queryScopedKnowledge(
      makeParams({ scope, datasetIdMap, executor: makeExecutor(responses) }),
    );

    expect(result.datasetsQueried).toBe(2);
    expect(result.totalBeforeFilter).toBe(2);
    // Both results have known non-private sources; both survive the privacy filter
    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.sourceDataset)).toEqual(["project-webapp", "alice-profile"]);
  });

  it("aborts long-running searches via timeout", async () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const datasetIdMap = new Map([["alice-private", "id-private"]]);

    const executor: SearchExecutor = {
      async search(params: Parameters<SearchExecutor["search"]>[0]) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => resolve([{ id: "r1", text: "slow result", score: 0.9 }]),
            5000,
          );
          params.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      },
    };

    const result = await queryScopedKnowledge(
      makeParams({ scope, datasetIdMap, executor, timeoutMs: 50 }),
    );

    // Search was aborted; error caught and returns empty
    expect(result.datasetsQueried).toBe(1);
    expect(result.results).toEqual([]);
  });

  it("handles executor failures gracefully", async () => {
    const scope: ScopeContext = { tier: "personal", userId: "alice", isGroupSession: false };
    const datasetIdMap = new Map([
      ["alice-private", "id-private"],
      ["alice-profile", "id-profile"],
    ]);

    const executor: SearchExecutor = {
      async search(params: Parameters<SearchExecutor["search"]>[0]) {
        if (params.datasetIds[0] === "id-private") {
          throw new Error("Network error");
        }
        return [{ id: "r1", text: "profile result", score: 0.8 }];
      },
    };

    const result = await queryScopedKnowledge(makeParams({ scope, datasetIdMap, executor }));

    // Only profile results returned, private query failed silently
    expect(result.results).toHaveLength(1);
    expect(result.results[0].sourceDataset).toBe("alice-profile");
  });
});
