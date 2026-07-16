import { describe, expect, it } from "vitest";
import { MAX_SEARCH_RESULTS, searchMeetings, type SearchableMeeting } from "../search";

const base = {
  category: "Board Meeting" as const,
  status: "PENDING_APPROVAL" as const,
  minutes: [],
  motions: [],
  tags: [],
  transcript: "",
};

const meetings: SearchableMeeting[] = [
  {
    ...base,
    id: "m-old",
    title: "April Board Meeting",
    date: "2026-04-28",
    transcript: "Calling the meeting to order. Discussion of pool resurfacing bids.",
  },
  {
    ...base,
    id: "m-new",
    title: "June Board Meeting",
    date: "2026-06-30",
    status: "COMPLETED",
    tags: ["Reserve Study", "Capital Works"],
    minutes: [{ id: "s1", heading: "Reserve study", body: "The board adopted the reserve study." }],
    motions: [{ id: "mo1", title: "Adopt the 2026 reserve study", movedBy: "P. Raman", secondedBy: null, outcome: "passed", votes: [] }],
  },
];

describe("searchMeetings", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(searchMeetings(meetings, "")).toEqual([]);
    expect(searchMeetings(meetings, "   ")).toEqual([]);
  });

  it("matches titles case-insensitively", () => {
    const hits = searchMeetings(meetings, "june board");
    expect(hits.map((hit) => hit.meeting.id)).toEqual(["m-new"]);
    expect(hits[0]?.matchedIn).toContain("title");
  });

  it("matches transcript, minutes, and motion text and reports where", () => {
    expect(searchMeetings(meetings, "pool resurfacing")[0]?.matchedIn).toEqual(["transcript"]);
    const reserve = searchMeetings(meetings, "reserve study");
    expect(reserve).toHaveLength(1);
    expect(reserve[0]?.matchedIn).toEqual(expect.arrayContaining(["minutes", "motions"]));
  });

  it("orders hits by meeting date, newest first", () => {
    const hits = searchMeetings(meetings, "board meeting");
    expect(hits.map((hit) => hit.meeting.id)).toEqual(["m-new", "m-old"]);
  });

  it("matches manual tags case-insensitively and reports the tags field", () => {
    const hits = searchMeetings(meetings, "capital works");
    expect(hits.map((hit) => hit.meeting.id)).toEqual(["m-new"]);
    expect(hits[0]?.matchedIn).toContain("tags");
  });

  it("returns an empty list when nothing matches", () => {
    expect(searchMeetings(meetings, "zzz-no-such-topic")).toEqual([]);
  });

  it("caps rendered results for predictable client work", () => {
    const many = Array.from({ length: MAX_SEARCH_RESULTS + 5 }, (_, index) => ({
      ...base, id: `m-${index}`, title: `Board meeting ${index}`, date: `2026-06-${String((index % 28) + 1).padStart(2, "0")}`,
    }));
    expect(searchMeetings(many, "board")).toHaveLength(MAX_SEARCH_RESULTS);
  });
});
