import type { MatchedParticipant, MeetingSource, UnmatchedParticipant } from "@/shared/types";

// AIDEV-NOTE: Grouping lives here (not in components) so review, signing, and archive
// modes all present the same matched/unmatched split of Teams participants.

export function matchedParticipants(source: Pick<MeetingSource, "participants">): MatchedParticipant[] {
  return source.participants.filter((p): p is MatchedParticipant => p.matched);
}

export function unmatchedParticipants(source: Pick<MeetingSource, "participants">): UnmatchedParticipant[] {
  return source.participants.filter((p): p is UnmatchedParticipant => !p.matched);
}
