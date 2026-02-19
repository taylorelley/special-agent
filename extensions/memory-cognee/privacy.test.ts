import { describe, expect, it } from "vitest";
import type { ScopeContext } from "../../src/scopes/types.js";
import type { AnnotatedSearchResult } from "./privacy.js";
import { filterRecallForPrivacy } from "./privacy.js";

function makeResult(id: string, sourceDataset?: string): AnnotatedSearchResult {
  return {
    id,
    text: `Result text for ${id}`,
    score: 0.9,
    sourceDataset,
  };
}

describe("filterRecallForPrivacy", () => {
  const groupScope: ScopeContext = {
    tier: "project",
    project: { id: "webapp", name: "Web App" },
    userId: "alice",
    isGroupSession: true,
  };

  const directScope: ScopeContext = {
    tier: "project",
    project: { id: "webapp", name: "Web App" },
    userId: "alice",
    isGroupSession: false,
  };

  it("passes all results through in 1:1 sessions", () => {
    const results: AnnotatedSearchResult[] = [
      makeResult("1", "alice-private"),
      makeResult("2", "alice-profile"),
      makeResult("3", "project-webapp"),
    ];

    const filtered = filterRecallForPrivacy(results, directScope);
    expect(filtered).toHaveLength(3);
  });

  it("filters out private results in group sessions", () => {
    const results: AnnotatedSearchResult[] = [
      makeResult("1", "alice-private"),
      makeResult("2", "alice-profile"),
      makeResult("3", "project-webapp"),
    ];

    const filtered = filterRecallForPrivacy(results, groupScope);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("filters out results with unknown source in group sessions", () => {
    const results: AnnotatedSearchResult[] = [
      makeResult("1", undefined),
      makeResult("2", "alice-profile"),
    ];

    const filtered = filterRecallForPrivacy(results, groupScope);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("2");
  });

  it("uses sourceDatasets map when annotation is missing", () => {
    const results: AnnotatedSearchResult[] = [
      makeResult("1", undefined),
      makeResult("2", undefined),
    ];

    const sourceDatasets = new Map([
      ["1", "alice-private"],
      ["2", "alice-profile"],
    ]);

    const filtered = filterRecallForPrivacy(results, groupScope, sourceDatasets);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("2");
  });

  it("allows team-shared results in group sessions", () => {
    const results: AnnotatedSearchResult[] = [
      makeResult("1", "team-shared"),
      makeResult("2", "alice-profile"),
    ];

    const filtered = filterRecallForPrivacy(results, groupScope);
    expect(filtered).toHaveLength(2);
  });

  it("handles empty results", () => {
    const filtered = filterRecallForPrivacy([], groupScope);
    expect(filtered).toEqual([]);
  });
});
