import type {
  ActiveMemberProfile,
  TranscriptImportAttendee,
} from "../../repositories/transcripts/transcriptRepository";
import { normalizeProfileEmail } from "../../../shared/schemas/profileEmail";

export interface SourceAttendee {
  displayName: string;
  email?: string | null;
}

export interface UnmatchedTranscriptAttendee {
  displayName: string;
  email: string | null;
  reason: "missing_email" | "invalid_email" | "not_found" | "ambiguous";
}

export interface TranscriptAttendeeMatches {
  matched: TranscriptImportAttendee[];
  unmatched: UnmatchedTranscriptAttendee[];
}

export function normalizeDisplayName(displayName: string): string {
  return displayName.trim().replace(/\s+/gu, " ");
}

export function matchTranscriptAttendees(
  attendees: readonly SourceAttendee[],
  profiles: readonly ActiveMemberProfile[],
): TranscriptAttendeeMatches {
  const profilesByEmail = new Map<string, ActiveMemberProfile[]>();
  for (const profile of profiles) {
    const normalizedEmail = normalizeProfileEmail(profile.email);
    if (!normalizedEmail) continue;
    const matchingProfiles = profilesByEmail.get(normalizedEmail) ?? [];
    matchingProfiles.push(profile);
    profilesByEmail.set(normalizedEmail, matchingProfiles);
  }

  const matched: TranscriptImportAttendee[] = [];
  const unmatched: UnmatchedTranscriptAttendee[] = [];
  const processedEmails = new Set<string>();
  for (const attendee of attendees) {
    const sourceEmail = attendee.email?.trim() || null;
    if (!sourceEmail) {
      unmatched.push({
        displayName: normalizeDisplayName(attendee.displayName),
        email: null,
        reason: "missing_email",
      });
      continue;
    }

    const normalizedEmail = normalizeProfileEmail(sourceEmail);
    if (!normalizedEmail) {
      unmatched.push({
        displayName: normalizeDisplayName(attendee.displayName),
        email: sourceEmail,
        reason: "invalid_email",
      });
      continue;
    }
    if (processedEmails.has(normalizedEmail)) continue;
    processedEmails.add(normalizedEmail);

    const matchingProfiles = profilesByEmail.get(normalizedEmail) ?? [];
    if (matchingProfiles.length === 1) {
      const profile = matchingProfiles[0];
      if (!profile) continue;
      matched.push({
        profileId: profile.profileId,
        displayNameSnapshot: normalizeDisplayName(attendee.displayName),
        sourceEmailSnapshot: normalizedEmail,
      });
      continue;
    }

    unmatched.push({
      displayName: normalizeDisplayName(attendee.displayName),
      email: normalizedEmail,
      reason: matchingProfiles.length === 0 ? "not_found" : "ambiguous",
    });
  }

  return { matched, unmatched };
}
