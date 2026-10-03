import { describe, expect, it } from "vitest";
import {
  matchManualTranscriptAttendeesByName,
  matchTranscriptAttendees,
  normalizeDisplayName,
} from "../../src/backend/services/transcripts/matchTranscriptAttendees";

const profiles = [
  {
    profileId: "10000000-0000-4000-8000-000000000001",
    displayName: "Ernesto",
    email: "ernesto@example.com",
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
      email: " ERNESTO@EXAMPLE.COM ",
    }], profiles)).toEqual({
      matched: [{
        profileId: "10000000-0000-4000-8000-000000000001",
        displayNameSnapshot: "Guest Display Name",
        sourceEmailSnapshot: "ernesto@example.com",
      }],
      unmatched: [],
    });
  });

  it("never uses a matching display name when email is missing or unknown", () => {
    expect(matchTranscriptAttendees([
      { displayName: "Ernesto", email: null },
      { displayName: "Marcus Patel", email: "unknown@example.test" },
    ], profiles)).toEqual({
      matched: [],
      unmatched: [
        { displayName: "Ernesto", email: null, reason: "missing_email" },
        { displayName: "Marcus Patel", email: "unknown@example.test", reason: "not_found" },
      ],
    });
  });

  it("keeps malformed source emails unmatched without rejecting the transcript", () => {
    expect(matchTranscriptAttendees([{
      displayName: "Ernesto",
      email: "not-an-email",
    }], profiles)).toEqual({
      matched: [],
      unmatched: [{
        displayName: "Ernesto",
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
        email: "ernesto@example.com",
      },
    ];

    expect(matchTranscriptAttendees([{
      displayName: "Ernesto",
      email: "ernesto@example.com",
    }], ambiguousProfiles)).toEqual({
      matched: [],
      unmatched: [{
        displayName: "Ernesto",
        email: "ernesto@example.com",
        reason: "ambiguous",
      }],
    });
  });

  it("deduplicates repeated provider participants by normalized email", () => {
    expect(matchTranscriptAttendees([
      { displayName: "Ernesto", email: "ernesto@example.com" },
      { displayName: "Duplicate Eleanor", email: " ERNESTO@EXAMPLE.COM " },
    ], profiles).matched).toEqual([{
      profileId: "10000000-0000-4000-8000-000000000001",
      displayNameSnapshot: "Ernesto",
      sourceEmailSnapshot: "ernesto@example.com",
    }]);
  });

  it("uses only the current profile email and never retains the previous email as an alias", () => {
    const changedProfiles = [{
      ...profiles[0]!,
      email: "eleanor.current@example.test",
    }];

    expect(matchTranscriptAttendees([{
      displayName: "Ernesto",
      email: "ernesto@example.com",
    }], changedProfiles).matched).toEqual([]);
    expect(matchTranscriptAttendees([{
      displayName: "Ernesto",
      email: "eleanor.current@example.test",
    }], changedProfiles).matched).toEqual([expect.objectContaining({
      profileId: profiles[0]!.profileId,
      sourceEmailSnapshot: "eleanor.current@example.test",
    })]);
  });

  it("links manual transcript speakers only by a unique exact normalized profile name", () => {
    expect(matchManualTranscriptAttendeesByName([
      { displayName: "  ERNESTO ", email: null },
      { displayName: "Marcus Patel", email: null },
      { displayName: "Unknown Guest", email: null },
    ], profiles)).toEqual({
      matched: [
        {
          profileId: "10000000-0000-4000-8000-000000000001",
          displayNameSnapshot: "ERNESTO",
        },
        {
          profileId: "10000000-0000-4000-8000-000000000002",
          displayNameSnapshot: "Marcus Patel",
        },
      ],
      unmatched: [{
        displayName: "Unknown Guest",
        email: null,
        reason: "not_found",
      }],
    });
  });

  it("does not guess a manual attendee when display names are ambiguous", () => {
    expect(matchManualTranscriptAttendeesByName([{
      displayName: "Ernesto",
      email: null,
    }], [
      ...profiles,
      {
        profileId: "10000000-0000-4000-8000-000000000003",
        displayName: " ernesto ",
        email: "another.eleanor@example.test",
      },
    ])).toEqual({
      matched: [],
      unmatched: [{
        displayName: "Ernesto",
        email: null,
        reason: "ambiguous",
      }],
    });
  });
});
