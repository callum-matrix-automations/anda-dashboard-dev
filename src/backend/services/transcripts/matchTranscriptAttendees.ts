import type {
  ActiveMemberProfile,
  TranscriptImportAttendee,
} from "../../repositories/transcripts/transcriptRepository";

export interface SourceAttendee {
  displayName: string;
}

export interface UnmatchedTranscriptAttendee {
  displayName: string;
  reason: "not_found" | "ambiguous";
}

export interface TranscriptAttendeeMatches {
  matched: TranscriptImportAttendee[];
  unmatched: UnmatchedTranscriptAttendee[];
}

export function normalizeDisplayName(displayName: string): string {
  return displayName.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-GB");
}

export function matchTranscriptAttendees(
  attendees: readonly SourceAttendee[],
  profiles: readonly ActiveMemberProfile[],
): TranscriptAttendeeMatches {
  const profilesByName = new Map<string, ActiveMemberProfile[]>();
  for (const profile of profiles) {
    const normalizedName = normalizeDisplayName(profile.displayName);
    const matchingProfiles = profilesByName.get(normalizedName) ?? [];
    matchingProfiles.push(profile);
    profilesByName.set(normalizedName, matchingProfiles);
  }

  const matched: TranscriptImportAttendee[] = [];
  const unmatched: UnmatchedTranscriptAttendee[] = [];
  for (const attendee of attendees) {
    const matchingProfiles = profilesByName.get(normalizeDisplayName(attendee.displayName)) ?? [];
    if (matchingProfiles.length === 1) {
      const profile = matchingProfiles[0];
      if (!profile) continue;
      matched.push({
        profileId: profile.profileId,
        displayNameSnapshot: profile.displayName,
      });
      continue;
    }

    unmatched.push({
      displayName: attendee.displayName,
      reason: matchingProfiles.length === 0 ? "not_found" : "ambiguous",
    });
  }

  return { matched, unmatched };
}
