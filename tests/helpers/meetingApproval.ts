import type { ApprovedMeetingSnapshot } from "../../src/shared/contracts/meetingApproval";

export const meetingId = "11111111-1111-4111-8111-111111111111";
export const runId = "22222222-2222-4222-8222-222222222222";
export const eleanorId = "10000000-0000-4000-8000-000000000001";
export const marcusId = "10000000-0000-4000-8000-000000000002";

export function approvedSnapshot({
  unresolvedVote = false,
  longDocument = false,
}: {
  unresolvedVote?: boolean;
  longDocument?: boolean;
} = {}): ApprovedMeetingSnapshot {
  const sections = longDocument
    ? Array.from({ length: 80 }, (_, index) => ({
      heading: `Agenda item ${index + 1}`,
      content: "The board reviewed the supporting information and recorded a detailed decision for the official minutes.",
    }))
    : [{ heading: "Decisions", content: "The board approved the proposal." }];
  return {
    schemaVersion: "1.0",
    meeting: {
      id: meetingId,
      sourceMeetingId: "source-board-meeting-1",
      title: "ANDA Board Meeting",
      meetingDate: "2026-07-19",
      durationMinutes: 90,
      contentVersion: 4,
    },
    minutes: {
      summary: "The board reviewed governance and finance matters.",
      sections,
    },
    attendees: [
      { profileId: eleanorId, displayName: "Eleanor Hughes" },
      { profileId: marcusId, displayName: "Marcus Patel" },
    ],
    motions: [{
      text: "Adopt the revised governance policy.",
      moverProfileId: eleanorId,
      moverDisplayName: "Eleanor Hughes",
      seconderProfileId: marcusId,
      seconderDisplayName: "Marcus Patel",
      outcome: "carried",
      votes: [
        { profileId: eleanorId, displayName: "Eleanor Hughes", selection: "for" },
        {
          profileId: marcusId,
          displayName: "Marcus Patel",
          selection: unresolvedVote ? "unresolved" : "against",
        },
      ],
    }],
    approval: {
      approvedByProfileId: eleanorId,
      approvedByDisplayName: "Eleanor Hughes",
      approvedAt: "2026-07-19T15:00:00.000Z",
      unresolvedVotesAcknowledged: unresolvedVote,
      unresolvedVoteCount: unresolvedVote ? 1 : 0,
    },
  };
}
