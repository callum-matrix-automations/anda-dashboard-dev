import { describe, expect, it } from "vitest";
import {
  matchTranscriptAttendees,
  normalizeDisplayName,
} from "../../src/backend/services/transcripts/matchTranscriptAttendees";

const profiles = [
  { profileId: "10000000-0000-4000-8000-000000000001", displayName: "Eleanor Hughes" },
  { profileId: "10000000-0000-4000-8000-000000000002", displayName: "Marcus Patel" },
];

describe("matchTranscriptAttendees", () => {
  it("normalizes case and repeated whitespace for an exact display-name match", () => {
    expect(normalizeDisplayName("  ELEANOR   Hughes  ")).toBe("eleanor hughes");
    expect(matchTranscriptAttendees([{ displayName: "  ELEANOR   Hughes  " }], profiles)).toEqual({
      matched: [{
        profileId: "10000000-0000-4000-8000-000000000001",
        displayNameSnapshot: "Eleanor Hughes",
      }],
      unmatched: [],
    });
  });

  it("does not fuzzy-match an unknown attendee", () => {
    expect(matchTranscriptAttendees([{ displayName: "Eleanor Hugh" }], profiles)).toEqual({
      matched: [],
      unmatched: [{ displayName: "Eleanor Hugh", reason: "not_found" }],
    });
  });

  it("leaves a duplicated profile name ambiguous instead of choosing a profile", () => {
    const duplicateProfiles = [
      ...profiles,
      { profileId: "10000000-0000-4000-8000-000000000003", displayName: "eLeAnOr  HuGhEs" },
    ];

    expect(matchTranscriptAttendees([{ displayName: "Eleanor Hughes" }], duplicateProfiles)).toEqual({
      matched: [],
      unmatched: [{ displayName: "Eleanor Hughes", reason: "ambiguous" }],
    });
  });
});
