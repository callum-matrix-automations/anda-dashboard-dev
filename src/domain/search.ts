import type { Meeting } from "./types";

// AIDEV-NOTE: Pure client-side search over the mock meeting corpus. Substring matching
// is intentional — deterministic, explainable, and adequate for the demo data volume.

export type SearchableMeeting = Pick<
  Meeting,
  "id" | "title" | "category" | "date" | "status" | "transcript" | "minutes" | "motions" | "tags"
>;

export type SearchField = "title" | "category" | "date" | "tags" | "minutes" | "motions" | "transcript";

export interface MeetingSearchHit<T extends SearchableMeeting = SearchableMeeting> {
  meeting: T;
  /** which parts of the record matched, in a stable presentation order */
  matchedIn: SearchField[];
}

export const MAX_SEARCH_QUERY_LENGTH = 200;
export const MAX_SEARCH_RESULTS = 50;

export function searchMeetings<T extends SearchableMeeting>(
  meetings: T[],
  query: string,
): MeetingSearchHit<T>[] {
  const needle = query.trim().slice(0, MAX_SEARCH_QUERY_LENGTH).toLowerCase();
  if (!needle) return [];
  const hits: MeetingSearchHit<T>[] = [];
  for (const meeting of meetings) {
    const matchedIn: SearchField[] = [];
    const has = (text: string) => text.toLowerCase().includes(needle);
    if (has(meeting.title)) matchedIn.push("title");
    if (has(meeting.category)) matchedIn.push("category");
    if (has(meeting.date)) matchedIn.push("date");
    if (meeting.tags.some((tag) => has(tag))) matchedIn.push("tags");
    if (meeting.minutes.some((section) => has(section.heading) || has(section.body))) matchedIn.push("minutes");
    if (meeting.motions.some((motion) => has(motion.title))) matchedIn.push("motions");
    if (has(meeting.transcript)) matchedIn.push("transcript");
    if (matchedIn.length > 0) hits.push({ meeting, matchedIn });
  }
  // ISO dates compare correctly as strings; newest records surface first.
  return hits.sort((a, b) => b.meeting.date.localeCompare(a.meeting.date)).slice(0, MAX_SEARCH_RESULTS);
}
