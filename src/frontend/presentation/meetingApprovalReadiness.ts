import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

export interface MotionApprovalIssue {
  motionIndex: number;
  messages: string[];
}

export function meetingApprovalReadinessIssues(meeting: MeetingApiDetail): string[] {
  const issues: string[] = [];

  if (!meeting.minutes) {
    issues.push("Minutes have not been created.");
  } else {
    if (!meeting.minutes.summary.trim()) issues.push("The minutes summary is empty.");
    if (meeting.minutes.sections.length === 0) issues.push("The minutes need at least one section.");
    meeting.minutes.sections.forEach((section, index) => {
      if (!section.heading.trim()) issues.push(`Minutes section ${index + 1} needs a heading.`);
      if (!section.content.trim()) issues.push(`Minutes section ${index + 1} needs content.`);
    });
  }

  if (meeting.attendees.length === 0) issues.push("At least one attendee must be recorded.");

  issues.push(...meetingApprovalMotionIssues(meeting).flatMap((issue) => issue.messages));

  return issues;
}

export function meetingApprovalInvalidMotionIndexes(meeting: MeetingApiDetail): number[] {
  return meetingApprovalMotionIssues(meeting).map((issue) => issue.motionIndex);
}

export function meetingApprovalMotionIssues(meeting: MeetingApiDetail): MotionApprovalIssue[] {
  return meeting.motions.flatMap((motion, index) => {
    const label = motionLabel(motion.text, index);
    const messages: string[] = [];
    if (!motion.text.trim()) messages.push(`${label} needs motion text.`);
    if (!motion.moverProfileId) messages.push(`${label} needs a mover.`);
    if (!motion.seconderProfileId && motion.outcome !== "not_seconded") messages.push(`${label} needs a seconder.`);
    if (motion.outcome === "unresolved") messages.push(`${label} needs a final outcome: carried, failed, or tabled.`);
    return messages.length > 0 ? [{ motionIndex: index, messages }] : [];
  });
}

function motionLabel(text: string, index: number): string {
  const normalized = text.trim();
  if (!normalized) return `Motion ${index + 1}`;
  const shortened = normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
  return `Motion ${index + 1} ("${shortened}")`;
}
