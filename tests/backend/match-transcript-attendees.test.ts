import { describe, expect, it } from "vitest";
import {
  matchTranscriptAttendees,
  normalizeDisplayName,
} from "../../src/backend/services/transcripts/matchTranscriptAttendees";

const profiles = [
  {
    profileId: "10000000-0000-4000-8000-000000000001",
    displayName: "Eleanor Hughes",
    email: "eleanor.hughes@example.test",
  },
  {
    profileId: "10000000-0000-4000-8000-000000000002",
    displayName: "Marcus Patel",
    email: "marcus.patel@example.test",
  },
];

describe("matchTranscriptAttendees", () => {
  it("matches only an exact normalized current email and preserves source snapshots", () => {
    expect(normalizeDisplayName("  Guest   Display Name  ")).toBe("Guest Display Name");
    expect(matchTranscriptAttendees([{
      displayName: "  Guest   Display Name  ",
      email: " ELEANOR.HUGHES@EXAMPLE.TEST ",
    }], profiles)).toEqual({
      matched: [{
        profileId: "10000000-0000-4000-8000-000000000001",
        displayNameSnapshot: "Guest Display Name",
        sourceEmailSnapshot: "eleanor.hughes@example.test",
      }],
      unmatched: [],
    });
  });

  it("never uses a matching display name when email is missing or unknown", () => {
    expect(matchTranscriptAttendees([
      { displayName: "Eleanor Hughes", email: null },
      { displayName: "Marcus Patel", email: "unknown@example.test" },
    ], profiles)).toEqual({
      matched: [],
      unmatched: [
        { displayName: "Eleanor Hughes", email: null, reason: "missing_email" },
        { displayName: "Marcus Patel", email: "unknown@example.test", reason: "not_found" },
      ],
    });
  });

  it("keeps malformed source emails unmatched without rejecting the transcript", () => {
    expect(matchTranscriptAttendees([{
      displayName: "Eleanor Hughes",
      email: "not-an-email",
    }], profiles)).toEqual({
      matched: [],
      unmatched: [{
        displayName: "Eleanor Hughes",
        email: "not-an-email",
        reason: "invalid_email",
      }],
    });
  });

  it("does not guess when defensive input contains duplicate current emails", () => {
    const ambiguousProfiles = [
      ...profiles,
      {
        profileId: "10000000-0000-4000-8000-000000000003",
        displayName: "Another Eleanor",
        email: "ELEANOR.HUGHES@example.test",
      },
    ];

    expect(matchTranscriptAttendees([{
      displayName: "Eleanor Hughes",
      email: "eleanor.hughes@example.test",
    }], ambiguousProfiles)).toEqual({
      matched: [],
      unmatched: [{
        displayName: "Eleanor Hughes",
        email: "eleanor.hughes@example.test",
        reason: "ambiguous",
      }],
    });
  });

  it("deduplicates repeated provider participants by normalized email", () => {
    expect(matchTranscriptAttendees([
      { displayName: "Eleanor Hughes", email: "eleanor.hughes@example.test" },
      { displayName: "Duplicate Eleanor", email: " ELEANOR.HUGHES@EXAMPLE.TEST " },
    ], profiles).matched).toEqual([{
      profileId: "10000000-0000-4000-8000-000000000001",
      displayNameSnapshot: "Eleanor Hughes",
      sourceEmailSnapshot: "eleanor.hughes@example.test",
    }]);
  });

  it("uses only the current profile email and never retains the previous email as an alias", () => {
    const changedProfiles = [{
      ...profiles[0]!,
      email: "eleanor.current@example.test",
    }];

    expect(matchTranscriptAttendees([{
      displayName: "Eleanor Hughes",
      email: "eleanor.hughes@example.test",
    }], changedProfiles).matched).toEqual([]);
    expect(matchTranscriptAttendees([{
      displayName: "Eleanor Hughes",
      email: "eleanor.current@example.test",
    }], changedProfiles).matched).toEqual([expect.objectContaining({
      profileId: profiles[0]!.profileId,
      sourceEmailSnapshot: "eleanor.current@example.test",
    })]);
  });
});
