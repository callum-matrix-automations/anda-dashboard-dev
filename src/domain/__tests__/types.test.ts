import { describe, expect, it } from "vitest";
import { MeetingContentSchema } from "../types";

const validContent = {
  minutes: [{ id: "section-1", heading: "Call to Order", body: "Quorum was confirmed." }],
  attendees: [{ memberId: "member-1", name: "Priya Raman", role: "Treasurer", present: true }],
  motions: [],
};

describe("MeetingContentSchema", () => {
  it("accepts a complete governance record", () => {
    expect(MeetingContentSchema.safeParse(validContent).success).toBe(true);
  });

  it.each([
    ["heading", { ...validContent, minutes: [{ ...validContent.minutes[0], heading: "  " }] }],
    ["body", { ...validContent, minutes: [{ ...validContent.minutes[0], body: "" }] }],
    ["attendee name", { ...validContent, attendees: [{ ...validContent.attendees[0], name: "" }] }],
  ])("rejects an empty %s", (_field, content) => {
    expect(MeetingContentSchema.safeParse(content).success).toBe(false);
  });
});
