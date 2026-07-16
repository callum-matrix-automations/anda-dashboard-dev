import { describe, expect, it } from "vitest";
import { MeetingContentSchema } from "../types";

describe("meeting content validation", () => {
  it("rejects a blank minutes heading", () => {
    const result = MeetingContentSchema.safeParse({ minutes: [{ id: "s1", heading: "  ", body: "Quorum confirmed." }], attendees: [], motions: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("Minutes heading is required.");
  });

  it("accepts concise, complete minutes", () => {
    expect(MeetingContentSchema.safeParse({ minutes: [{ id: "s1", heading: "Call to Order", body: "Quorum confirmed." }], attendees: [], motions: [] }).success).toBe(true);
  });
});
