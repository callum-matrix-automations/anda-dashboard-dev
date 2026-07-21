import { describe, expect, it } from "vitest";
import {
  ApprovedMeetingSnapshotSchema,
  ApproveMeetingCommandSchema,
  MinutesPdfArtifactSchema,
} from "../../src/shared/contracts/meetingApproval";
import { approvedSnapshot } from "../helpers/meetingApproval";

describe("meeting approval contracts", () => {
  it("accepts a complete immutable snapshot with acknowledged unresolved votes", () => {
    expect(ApprovedMeetingSnapshotSchema.safeParse(approvedSnapshot({ unresolvedVote: true })).success).toBe(true);
  });

  it("rejects unresolved motion information after approval", () => {
    const snapshot = approvedSnapshot();
    const result = ApprovedMeetingSnapshotSchema.safeParse({
      ...snapshot,
      motions: [{ ...snapshot.motions[0], outcome: "unresolved" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a final not-seconded motion without a seconder", () => {
    const snapshot = approvedSnapshot();
    expect(ApprovedMeetingSnapshotSchema.safeParse({
      ...snapshot,
      motions: [{
        ...snapshot.motions[0],
        seconderProfileId: null,
        seconderDisplayName: null,
        outcome: "not_seconded",
      }],
    }).success).toBe(true);
  });

  it("requires an explicit acknowledgement boolean and positive expected version", () => {
    expect(ApproveMeetingCommandSchema.safeParse({ expectedVersion: 4 }).success).toBe(false);
    expect(ApproveMeetingCommandSchema.safeParse({
      meetingId: "11111111-1111-4111-8111-111111111111",
      actorProfileId: "10000000-0000-4000-8000-000000000001",
      expectedVersion: 0,
      acknowledgeUnresolvedVotes: false,
    }).success).toBe(false);
    expect(ApproveMeetingCommandSchema.safeParse({
      meetingId: "11111111-1111-4111-8111-111111111111",
      actorProfileId: "10000000-0000-4000-8000-000000000001",
      expectedVersion: 4,
      acknowledgeUnresolvedVotes: false,
    }).success).toBe(true);
  });

  it("validates persisted PDF checksums and metadata", () => {
    const artifact = {
      id: "33333333-3333-4333-8333-333333333333",
      path: "unsigned/meeting/v4/minutes.pdf",
      sha256: "a".repeat(64),
      sizeBytes: 1_024,
      pageCount: 3,
      generatedAt: "2026-07-19T15:01:00.000Z",
      documentVersion: 4,
    };
    expect(MinutesPdfArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(MinutesPdfArtifactSchema.safeParse({ ...artifact, sha256: "not-a-checksum" }).success).toBe(false);
  });
});
