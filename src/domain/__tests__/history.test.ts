import { describe, expect, it } from "vitest";
import { ReviewHistoryEntrySchema } from "../types";
import { appendHistoryEntry, newestFirst } from "../history";

const entry = (id: string, at: string) => ({
  id,
  actor: "Daniel Okafor",
  action: "edit_saved" as const,
  at,
  note: null,
});

describe("review history", () => {
  it("accepts a well-formed entry with an optional note", () => {
    expect(ReviewHistoryEntrySchema.safeParse(entry("h1", "2026-07-01T10:00:00Z")).success).toBe(true);
    expect(
      ReviewHistoryEntrySchema.safeParse({ ...entry("h1", "2026-07-01T10:00:00Z"), note: "Fixed vote tally." }).success,
    ).toBe(true);
  });

  it("rejects field-level snapshots — entries carry no record payloads", () => {
    const withSnapshot = { ...entry("h1", "2026-07-01T10:00:00Z"), snapshot: { minutes: [] } };
    expect(ReviewHistoryEntrySchema.safeParse(withSnapshot).success).toBe(false);
  });

  it("rejects unknown actions and blank actors", () => {
    expect(ReviewHistoryEntrySchema.safeParse({ ...entry("h1", "x"), action: "reformatted" }).success).toBe(false);
    expect(ReviewHistoryEntrySchema.safeParse({ ...entry("h1", "x"), actor: " " }).success).toBe(false);
  });

  it("appends without mutating the original list", () => {
    const first = [ReviewHistoryEntrySchema.parse(entry("h1", "2026-07-01T10:00:00Z"))];
    const next = appendHistoryEntry(first, ReviewHistoryEntrySchema.parse(entry("h2", "2026-07-02T10:00:00Z")));
    expect(first).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(next[1]?.id).toBe("h2");
  });

  it("orders newest first for display without reordering storage", () => {
    const stored = [
      ReviewHistoryEntrySchema.parse(entry("h1", "2026-07-01T10:00:00Z")),
      ReviewHistoryEntrySchema.parse(entry("h2", "2026-07-03T10:00:00Z")),
      ReviewHistoryEntrySchema.parse(entry("h3", "2026-07-02T10:00:00Z")),
    ];
    expect(newestFirst(stored).map((e) => e.id)).toEqual(["h2", "h3", "h1"]);
    expect(stored.map((e) => e.id)).toEqual(["h1", "h2", "h3"]);
  });
});
