import { describe, expect, it } from "vitest";
import { MeetingSourceSchema, SourceParticipantSchema } from "../types";
import { matchedParticipants, unmatchedParticipants } from "../provenance";

const source = {
  provider: "Microsoft Teams",
  reference: "teams:19:meeting_NzQ4-board-jul",
  importedAt: "2026-07-14T19:05:00Z",
  importStatus: "imported" as const,
  participants: [
    { id: "p1", displayName: "Priya Raman", matched: true as const, memberId: "mem-01", memberName: "Priya Raman" },
    { id: "p2", displayName: "D. Okafor (Guest)", matched: false as const, reason: "Display name does not match any active board member." },
  ],
};

describe("meeting source provenance", () => {
  it("parses a valid Teams source with matched and unmatched participants", () => {
    const parsed = MeetingSourceSchema.safeParse(source);
    expect(parsed.success).toBe(true);
  });

  it("rejects a matched participant without a member identity", () => {
    const result = SourceParticipantSchema.safeParse({ id: "p3", displayName: "X", matched: true });
    expect(result.success).toBe(false);
  });

  it("rejects an unmatched participant without a reason", () => {
    const result = SourceParticipantSchema.safeParse({ id: "p3", displayName: "X", matched: false, reason: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty provider or reference", () => {
    expect(MeetingSourceSchema.safeParse({ ...source, provider: " " }).success).toBe(false);
    expect(MeetingSourceSchema.safeParse({ ...source, reference: "" }).success).toBe(false);
  });

  it("groups participants into matched and unmatched", () => {
    const parsed = MeetingSourceSchema.parse(source);
    const matched = matchedParticipants(parsed);
    const unmatched = unmatchedParticipants(parsed);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.memberId).toBe("mem-01");
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]?.reason).toContain("active board member");
  });

  it("returns empty groups when the source has no participants", () => {
    const empty = MeetingSourceSchema.parse({ ...source, participants: [] });
    expect(matchedParticipants(empty)).toEqual([]);
    expect(unmatchedParticipants(empty)).toEqual([]);
  });
});
