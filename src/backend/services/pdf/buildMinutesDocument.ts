import {
  ApprovedMeetingSnapshotSchema,
  type ApprovedMeetingSnapshot,
} from "../../../shared/contracts/meetingApproval";

export interface MinutesDocumentMotion {
  text: string;
  mover: string;
  seconder: string;
  outcome: string;
  votes: Array<{ voter: string; selection: string }>;
}

export interface MinutesDocumentModel {
  organisationName: "ANDA";
  documentTitle: "Meeting Minutes";
  meeting: {
    title: string;
    date: string;
    duration: string;
    sourceReference: string;
  };
  attendance: string[];
  minutes: {
    summary: string;
    sections: Array<{ heading: string; content: string }>;
  };
  motions: MinutesDocumentMotion[];
  approval: {
    approvedBy: string;
    approvedAt: string;
    approvedAtIso: string;
    unresolvedVoteCount: number;
    unresolvedVotesAcknowledged: boolean;
  };
  documentVersion: number;
}

export function buildMinutesDocument(snapshotInput: ApprovedMeetingSnapshot): MinutesDocumentModel {
  const snapshot = ApprovedMeetingSnapshotSchema.parse(snapshotInput);
  return {
    organisationName: "ANDA",
    documentTitle: "Meeting Minutes",
    meeting: {
      title: snapshot.meeting.title,
      date: formatMeetingDate(snapshot.meeting.meetingDate),
      duration: snapshot.meeting.durationMinutes === null
        ? "Not recorded"
        : `${snapshot.meeting.durationMinutes} minutes`,
      sourceReference: snapshot.meeting.sourceMeetingId,
    },
    attendance: snapshot.attendees.map((attendee) => attendee.displayName),
    minutes: {
      summary: snapshot.minutes.summary,
      sections: snapshot.minutes.sections.map((section) => ({ ...section })),
    },
    motions: snapshot.motions.map((motion) => ({
      text: motion.text,
      mover: motion.moverDisplayName,
      seconder: motion.seconderDisplayName ?? "No seconder recorded",
      outcome: motion.outcome === "not_seconded" ? "Not seconded - not put to vote" : titleCase(motion.outcome),
      votes: motion.votes.map((vote) => ({
        voter: vote.displayName,
        selection: titleCase(vote.selection),
      })),
    })),
    approval: {
      approvedBy: snapshot.approval.approvedByDisplayName,
      approvedAt: formatApprovalTimestamp(snapshot.approval.approvedAt),
      approvedAtIso: snapshot.approval.approvedAt,
      unresolvedVoteCount: snapshot.approval.unresolvedVoteCount,
      unresolvedVotesAcknowledged: snapshot.approval.unresolvedVotesAcknowledged,
    },
    documentVersion: snapshot.meeting.contentVersion,
  };
}

function titleCase(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).toLowerCase()}`;
}

function formatMeetingDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatApprovalTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}
