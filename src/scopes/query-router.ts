/**
 * Scope-Aware Query Router
 *
 * Fires parallel Cognee searches across all relevant datasets for the current
 * scope context, then merges, de-duplicates, and re-ranks results.
 */

import type {
  CogneeSearchResult,
  CogneeSearchType,
} from "../../extensions/memory-cognee/client.js";
import type { AnnotatedSearchResult } from "../../extensions/memory-cognee/privacy.js";
import type { ScopeContext, ScopeTier } from "./types.js";
import { filterRecallForPrivacy } from "../../extensions/memory-cognee/privacy.js";
import {
  resolveRecallDatasets,
  classifyDataset,
} from "../../extensions/memory-cognee/scoped-datasets.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A search result annotated with source provenance. */
export type ScopedSearchResult = CogneeSearchResult & {
  /** Which dataset this result came from. */
  sourceDataset: string;
  /** Which scope tier the source dataset belongs to. */
  sourceTier: ScopeTier;
};

/** Result of a scoped query across multiple datasets. */
export type ScopedQueryResult = {
  /** Merged, filtered, and ranked results. */
  results: ScopedSearchResult[];
  /** Number of datasets queried. */
  datasetsQueried: number;
  /** Total results before filtering. */
  totalBeforeFilter: number;
};

/** Interface for executing searches — abstracts the Cognee client. */
export type SearchExecutor = {
  search(params: {
    queryText: string;
    searchType: CogneeSearchType;
    datasetIds: string[];
    maxTokens: number;
    signal?: AbortSignal;
  }): Promise<CogneeSearchResult[]>;
};

/** Parameters for a scoped query. */
export type ScopedQueryParams = {
  /** The search query text. */
  query: string;
  /** Current scope context (determines which datasets to query). */
  scope: ScopeContext;
  /** Search executor (Cognee client). */
  executor: SearchExecutor;
  /** Map of dataset name → Cognee dataset ID. */
  datasetIdMap: Map<string, string>;
  /** Search type (GRAPH_COMPLETION, CHUNKS, SUMMARIES). */
  searchType: CogneeSearchType;
  /** Maximum tokens per search. */
  maxTokens: number;
  /** Maximum results to return after merging. */
  maxResults: number;
  /** Minimum score threshold. */
  minScore: number;
  /** Combined timeout for all parallel queries (ms). */
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

/**
 * Execute a scoped query across all relevant datasets.
 *
 * 1. Resolves which datasets to query based on scope context.
 * 2. Fires parallel searches against each dataset that has a known Cognee ID.
 * 3. Annotates results with source provenance.
 * 4. Applies privacy filtering for group sessions.
 * 5. Sorts by score, de-duplicates by text, and trims to maxResults.
 */
export async function queryScopedKnowledge(params: ScopedQueryParams): Promise<ScopedQueryResult> {
  const { scope, executor, datasetIdMap, searchType, maxTokens, maxResults, minScore } = params;
  const timeoutMs = params.timeoutMs ?? 30_000;

  // 1. Determine which dataset names to query
  const datasetNames = resolveRecallDatasets(scope);

  // 2. Map names to Cognee IDs, skip any without a known ID
  const queries: Array<{ name: string; id: string }> = [];
  for (const name of datasetNames) {
    const id = datasetIdMap.get(name);
    if (id) {
      queries.push({ name, id });
    }
  }

  if (queries.length === 0) {
    return { results: [], datasetsQueried: 0, totalBeforeFilter: 0 };
  }

  // 3. Fire parallel searches with a combined timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let allResults: ScopedSearchResult[];
  try {
    const searchPromises = queries.map(async ({ name, id }) => {
      try {
        const results = await executor.search({
          queryText: params.query,
          searchType,
          datasetIds: [id],
          maxTokens,
          signal: controller.signal,
        });
        const source = classifyDataset(name, scope.userId);
        return results.map(
          (r): ScopedSearchResult => ({
            ...r,
            sourceDataset: name,
            sourceTier: source.tier,
          }),
        );
      } catch {
        // Individual dataset failures are non-fatal
        return [] as ScopedSearchResult[];
      }
    });

    const resultArrays = await Promise.all(searchPromises);
    allResults = resultArrays.flat();
  } finally {
    clearTimeout(timeout);
  }

  const totalBeforeFilter = allResults.length;

  // 4. Apply privacy filter (use composite key: dataset:id for cross-dataset dedup)
  const annotated: AnnotatedSearchResult[] = allResults.map((r) => ({
    ...r,
    sourceDataset: r.sourceDataset,
  }));
  const privacyFiltered = filterRecallForPrivacy(annotated, scope);

  // Map back to ScopedSearchResult using composite key (dataset-aware)
  const privacyFilteredSet = new Set(privacyFiltered.map((r) => `${r.sourceDataset}:${r.id}`));
  const filtered = allResults.filter((r) => privacyFilteredSet.has(`${r.sourceDataset}:${r.id}`));

  // 5. Apply score threshold, sort by score, then de-duplicate by text
  const seen = new Set<string>();
  const deduped = filtered
    .filter((r) => r.score >= minScore)
    .toSorted((a, b) => b.score - a.score)
    .filter((r) => {
      const key = r.text.trim().toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, maxResults);

  return {
    results: deduped,
    datasetsQueried: queries.length,
    totalBeforeFilter,
  };
}
