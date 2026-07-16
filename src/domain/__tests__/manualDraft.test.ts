import { describe, expect, it } from "vitest";
import { attendanceIssues, draftIssues, isDraftComplete, minutesIssues, motionIssues } from "../manualDraft";

const validDraft = {
  minutes: [{ id: "s1", heading: "Call to Order", body: "Quorum confirmed." }],
  attendees: [{ memberId: "m1", name: "Priya Raman", role: "Treasurer", present: true }],
  motions: [
    {
      id: "mot-1",
      title: "Award contract",
      movedBy: "Priya Raman",
      secondedBy: null,
      outcome: "passed" as const,
      votes: [{ memberId: "m1", memberName: "Priya Raman", result: "yes" as const }],
    },
  ],
};

describe("manual draft validation", () => {
  it("accepts a complete draft", () => {
    expect(draftIssues(validDraft)).toEqual([]);
    expect(isDraftComplete(validDraft)).toBe(true);
  });

  it("requires at least one minutes section", () => {
    expect(minutesIssues([])).toContain("Add at least one minutes section.");
  });

  it("requires every minutes section to have a heading and body", () => {
    const issues = minutesIssues([{ id: "s1", heading: " ", body: "" }]);
    expect(issues.some((issue) => /heading/i.test(issue))).toBe(true);
    expect(issues.some((issue) => /body/i.test(issue))).toBe(true);
  });

  it("requires at least one attendee with a name and role", () => {
    expect(attendanceIssues([])).toContain("Add at least one attendee.");
    expect(attendanceIssues([{ memberId: "m1", name: "", role: "Member", present: true }])).toContain(
      "Every attendee needs a name and role.",
    );
  });

  it("allows zero motions but validates present ones", () => {
    expect(motionIssues([])).toEqual([]);
    const issues = motionIssues([{ ...validDraft.motions[0]!, title: " ", movedBy: "" }]);
    expect(issues.some((issue) => /title/i.test(issue))).toBe(true);
    expect(issues.some((issue) => /mover/i.test(issue))).toBe(true);
  });

  it("requires every vote to name a member", () => {
    const issues = motionIssues([
      { ...validDraft.motions[0]!, votes: [{ memberId: "v1", memberName: " ", result: "yes" }] },
    ]);
    expect(issues.some((issue) => /vote/i.test(issue))).toBe(true);
  });

  it("aggregates all issues for the review step", () => {
    const issues = draftIssues({ minutes: [], attendees: [], motions: [] });
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});
