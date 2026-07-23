import { describe, expect, it } from "vitest";
import {
  MeetingApiErrorResponseSchema,
  MeetingApiListQuerySchema,
  MeetingApiSaveDraftRequestSchema,
  MeetingApiSigningSessionSchema,
  MeetingApiSourceParticipantSchema,
  MeetingApiVersionedRequestSchema,
} from "../../src/shared/contracts/meetingApi";

const profileId = "11111111-1111-4111-8111-111111111111";

describe("meeting HTTP contracts", () => {
  it("accepts bounded queue filters and rejects unknown lifecycle values", () => {
    expect(MeetingApiListQuerySchema.safeParse({ queue: "needs-review" }).success).toBe(true);
    expect(MeetingApiListQuerySchema.safeParse({ queue: "unknown" }).success).toBe(false);
    expect(MeetingApiListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("strictly excludes client-supplied actor identity from mutation bodies", () => {
    const draft = {
      expectedVersion: 2,
      actorProfileId: profileId,
      draft: {
        minutes: {
          summary: "Summary",
          sections: [{ heading: "Opening", content: "Meeting opened." }],
        },
        attendeeProfileIds: [profileId],
        motions: [],
        tags: [],
      },
    };
    expect(MeetingApiSaveDraftRequestSchema.safeParse(draft).success).toBe(false);
  });

  it("limits analysis retry requests to the expected meeting version", () => {
    expect(MeetingApiVersionedRequestSchema.safeParse({ expectedVersion: 2 }).success).toBe(true);
    expect(MeetingApiVersionedRequestSchema.safeParse({
      expectedVersion: 2,
      actorProfileId: profileId,
      transcript: "replacement evidence",
      model: "replacement-model",
    }).success).toBe(false);
  });

  it("requires source participant match state to agree with its profile link", () => {
    expect(MeetingApiSourceParticipantSchema.safeParse({
      displayName: "Eleanor Hughes",
      email: "eleanor@example.test",
      profileId,
      matchStatus: "matched",
    }).success).toBe(true);
    expect(MeetingApiSourceParticipantSchema.safeParse({
      displayName: "Unmatched Guest",
      email: "guest@example.test",
      profileId,
      matchStatus: "unmatched",
    }).success).toBe(false);
  });

  it("keeps provider identifiers out of the public signing-session response", () => {
    expect(MeetingApiSigningSessionSchema.safeParse({
      meetingId: profileId,
      documentVersion: 2,
      providerStatus: "in_progress",
      recipientEmail: "treasurer@example.test",
      signingUrl: "https://app.firma.dev/signing/recipient",
    }).success).toBe(true);
    expect(MeetingApiSigningSessionSchema.safeParse({
      meetingId: profileId,
      documentVersion: 2,
      providerStatus: "in_progress",
      recipientEmail: "treasurer@example.test",
      signingUrl: "https://app.firma.dev/signing/recipient",
      externalRequestId: "provider-secret-reference",
    }).success).toBe(false);
  });

  it("validates the common safe error envelope", () => {
    expect(MeetingApiErrorResponseSchema.safeParse({
      error: {
        code: "version_conflict",
        message: "Meeting changed after it was loaded.",
        currentVersion: 7,
      },
    }).success).toBe(true);
  });
});
