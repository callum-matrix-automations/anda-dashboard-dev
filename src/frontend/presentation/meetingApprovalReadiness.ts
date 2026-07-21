import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

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

  meeting.motions.forEach((motion, index) => {
    const label = motionLabel(motion.text, index);
    if (!motion.text.trim()) issues.push(`${label} needs motion text.`);
    if (!motion.moverProfileId) issues.push(`${label} needs a mover.`);
    if (!motion.seconderProfileId && motion.outcome !== "not_seconded") issues.push(`${label} needs a seconder.`);
    if (motion.outcome === "unresolved") {
      issues.push(`${label} needs a final outcome: carried, failed, or tabled.`);
    }
  });

  return issues;
}

function motionLabel(text: string, index: number): string {
  const normalized = text.trim();
  if (!normalized) return `Motion ${index + 1}`;
  const shortened = normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
  return `Motion ${index + 1} ("${shortened}")`;
}
