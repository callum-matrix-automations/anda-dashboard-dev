import { describe, expect, it } from "vitest";
import { artifactStateFor } from "../../src/frontend/presentation/artifact";
import { newestFirst } from "../../src/frontend/presentation/history";
import { matchedParticipants, unmatchedParticipants } from "../../src/frontend/presentation/provenance";
import { statusTone } from "../../src/frontend/components/shared/meetingPresentation";

describe("frontend presentation helpers", () => {
  it("maps lifecycle values without mutating them", () => {
    expect(artifactStateFor("PDF_PROCESSING")).toBe("processing");
    expect(artifactStateFor("COMPLETED")).toBe("signed");
  });

  it("sorts real API history newest first without changing the source", () => {
    const history = [
      { id: "1", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", createdAt: "2026-01-02T00:00:00Z" },
    ];
    expect(newestFirst(history).map((entry) => entry.id)).toEqual(["2", "1"]);
    expect(history.map((entry) => entry.id)).toEqual(["1", "2"]);
  });

  it("uses the warning pill for a meeting awaiting a treasurer signature", () => {
    expect(statusTone.AWAITING_SIGNATURE).toBe("warning");
  });

  it("separates matched and unmatched Read AI participants", () => {
    const participants = [
      {
        displayName: "Eleanor Hughes",
        email: "eleanor@example.test",
        profileId: "11111111-1111-4111-8111-111111111111",
        matchStatus: "matched" as const,
      },
      {
        displayName: "Guest Speaker",
        email: "guest@example.test",
        profileId: null,
        matchStatus: "unmatched" as const,
      },
    ];

    expect(matchedParticipants(participants).map((participant) => participant.displayName)).toEqual(["Eleanor Hughes"]);
    expect(unmatchedParticipants(participants).map((participant) => participant.displayName)).toEqual(["Guest Speaker"]);
  });
});
