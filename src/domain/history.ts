import type { ReviewHistoryEntry } from "./types";

// AIDEV-NOTE: History is append-only. Storage stays chronological (oldest first);
// timelines call newestFirst for display so the stored order is never rewritten.

export function appendHistoryEntry(
  history: readonly ReviewHistoryEntry[],
  entry: ReviewHistoryEntry,
): ReviewHistoryEntry[] {
  return [...history, entry];
}

export function newestFirst(history: readonly ReviewHistoryEntry[]): ReviewHistoryEntry[] {
  // ISO timestamps compare correctly as strings.
  return [...history].sort((a, b) => b.at.localeCompare(a.at));
}
