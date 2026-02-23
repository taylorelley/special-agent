/**
 * Privacy / Disclosure Policy Enforcement
 *
 * Post-retrieval filter that removes results that should not appear
 * in the current session context. This is a second line of defense
 * after resolveRecallDatasets() — if a result somehow slips through
 * the dataset selection, this filter catches it.
 *
 * Disclosure policy:
 * - In group sessions: personal private content is NEVER shown.
 * - Work preferences and skills (profile): always available.
 * - Project knowledge: available to project members.
 * - Team knowledge: available in project and team scopes.
 */

import type { ScopeContext } from "../../src/scopes/types.js";
import type { CogneeSearchResult } from "./client.js";
import { classifyDataset } from "./scoped-datasets.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A search result annotated with its source dataset. */
export type AnnotatedSearchResult = CogneeSearchResult & {
  sourceDataset?: string;
};

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Filter search results based on the current scope's privacy rules.
 *
 * @param results - Search results with optional source dataset annotation.
 * @param scope - Current session scope context.
 * @param sourceDatasets - Map of result ID → dataset name (for results without annotation).
 * @returns Filtered results safe for the current context.
 */
export function filterRecallForPrivacy(
  results: AnnotatedSearchResult[],
  scope: ScopeContext,
  sourceDatasets?: Map<string, string>,
): AnnotatedSearchResult[] {
  // In 1:1 sessions, no additional filtering needed — resolveRecallDatasets
  // already limits which datasets are queried.
  if (!scope.isGroupSession) {
    return results;
  }

  // In group sessions, filter out any private personal content.
  return results.filter((result) => {
    const datasetName = result.sourceDataset ?? sourceDatasets?.get(result.id);

    if (!datasetName) {
      // Unknown source — conservatively exclude in group sessions.
      return false;
    }

    const source = classifyDataset(datasetName, scope.userId);
    return !source.isPrivate;
  });
}
