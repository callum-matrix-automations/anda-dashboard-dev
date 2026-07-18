import type { ReviewHistoryEntry } from "@/shared/types";

export function newestFirst(history: readonly ReviewHistoryEntry[]): ReviewHistoryEntry[] {
  return [...history].sort((left, right) => right.at.localeCompare(left.at));
}
