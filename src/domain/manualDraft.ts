import type { Attendee, Meeting, MinutesSection, Motion } from "./types";

// AIDEV-NOTE: Completion rules for the manual draft builder. A record cannot be marked
// Ready for Review until these pass — enforced in BOTH the wizard UI and the mock
// repository so a direct action can never sneak an empty draft into approval.

export interface ManualDraftContent {
  minutes: MinutesSection[];
  attendees: Attendee[];
  motions: Motion[];
}

export function minutesIssues(minutes: MinutesSection[]): string[] {
  const issues: string[] = [];
  if (minutes.length === 0) issues.push("Add at least one minutes section.");
  if (minutes.some((section) => !section.heading.trim())) issues.push("Every minutes section needs a heading.");
  if (minutes.some((section) => !section.body.trim())) issues.push("Every minutes section needs a body.");
  return issues;
}

export function attendanceIssues(attendees: Attendee[]): string[] {
  const issues: string[] = [];
  if (attendees.length === 0) issues.push("Add at least one attendee.");
  if (attendees.some((attendee) => !attendee.name.trim() || !attendee.role.trim())) {
    issues.push("Every attendee needs a name and role.");
  }
  return issues;
}

// Motions and vote rows are optional. Any supplied motion fields and vote rows must be complete.
export function motionFieldIssues(motions: Motion[]): string[] {
  const issues: string[] = [];
  if (motions.some((motion) => !motion.title.trim())) issues.push("Every motion needs a title.");
  if (motions.some((motion) => !motion.movedBy.trim())) issues.push("Every motion needs a mover.");
  return issues;
}

export function voteIssues(motions: Motion[]): string[] {
  return motions.some((motion) => motion.votes.some((vote) => !vote.memberName.trim()))
    ? ["Every vote must name a member."]
    : [];
}

export function motionIssues(motions: Motion[]): string[] {
  return [...motionFieldIssues(motions), ...voteIssues(motions)];
}

export function draftIssues(content: ManualDraftContent): string[] {
  return [...minutesIssues(content.minutes), ...attendanceIssues(content.attendees), ...motionIssues(content.motions)];
}

export function isDraftComplete(content: ManualDraftContent): boolean {
  return draftIssues(content).length === 0;
}

export function meetingDraftContent(meeting: Pick<Meeting, "minutes" | "attendees" | "motions">): ManualDraftContent {
  return { minutes: meeting.minutes, attendees: meeting.attendees, motions: meeting.motions };
}
