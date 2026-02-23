/**
 * Knowledge Entry Schema
 *
 * Defines the types of structured knowledge that can be stored across scopes.
 * This schema is used by the extraction gate (Phase 4) and by tools that
 * create knowledge entries.
 */

import type { ScopeTier } from "./types.js";

/** The types of knowledge entries that can be stored. */
export type KnowledgeEntryType =
  | "adr"
  | "runbook"
  | "bug_pattern"
  | "convention"
  | "contract"
  | "reference";

/** Confidence level for a knowledge entry. */
export type KnowledgeConfidence = "established" | "provisional" | "experimental";

/** Metadata for a knowledge entry. */
export type KnowledgeEntryMetadata = {
  /** Entry type. */
  type: KnowledgeEntryType;
  /** Short title (max 200 chars). */
  title: string;
  /** Summary (max 2000 chars). */
  summary: string;
  /** Which scope tier this entry belongs to. */
  scope: ScopeTier;
  /** Project ID (when scope is "project"). */
  project?: string;
  /** Author user ID. */
  author?: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Confidence level. */
  confidence?: KnowledgeConfidence;
  /** Tags for categorisation. */
  tags?: string[];
  /** Source reference (PR number, task ID, conversation date, file path). */
  sourceRef?: string;
  /** Entry ID that this entry supersedes (same dataset). */
  supersedesEntryId?: string;
};

/** Display labels for knowledge entry types. */
export const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeEntryType, string> = {
  adr: "Architecture Decision Record",
  runbook: "Runbook",
  bug_pattern: "Bug Pattern",
  convention: "Convention",
  contract: "API Contract",
  reference: "Cross-Scope Reference",
};
