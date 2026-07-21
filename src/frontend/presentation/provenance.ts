import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

type SourceParticipant = MeetingApiDetail["sourceParticipants"][number];

export function matchedParticipants(participants: readonly SourceParticipant[]): SourceParticipant[] {
  return participants.filter((participant) => participant.matchStatus === "matched");
}

export function unmatchedParticipants(participants: readonly SourceParticipant[]): SourceParticipant[] {
  return participants.filter((participant) => participant.matchStatus === "unmatched");
}
