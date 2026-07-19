import { describe, expect, it } from "vitest";
import {
  MeetingSigningClaimSchema,
  MeetingSigningFailureSchema,
  RetryMeetingSigningCommandSchema,
  SigningRecipientSchema,
} from "../../src/shared/contracts/meetingSigning";
import { eleanorId, meetingId, runId } from "../helpers/meetingApproval";

describe("meeting signing contracts", () => {
  it("accepts a configured signer and normalises surrounding whitespace", () => {
    expect(SigningRecipientSchema.parse({
      firstName: "  Test ",
      lastName: " Treasurer  ",
      email: " treasurer@example.test ",
    })).toEqual({
      firstName: "Test",
      lastName: "Treasurer",
      email: "treasurer@example.test",
    });
  });

  it("rejects incomplete or malformed signer details", () => {
    expect(() => SigningRecipientSchema.parse({
      firstName: "Test",
      lastName: "",
      email: "not-an-email",
    })).toThrow();
  });

  it("accepts the immutable approved PDF delivery claim", () => {
    expect(MeetingSigningClaimSchema.parse({
      status: "claimed",
      meetingId,
      runId,
      attempt: 2,
      pdfId: "33333333-3333-4333-8333-333333333333",
      pdfPath: `unsigned/${meetingId}/v4/minutes.pdf`,
      pdfSha256: "a".repeat(64),
      pdfSizeBytes: 12_345,
      documentVersion: 4,
      requestName: `ANDA meeting ${meetingId} v4`,
      externalRequestId: null,
    })).toMatchObject({ status: "claimed", attempt: 2, documentVersion: 4 });
  });

  it("rejects claims whose checksum or stored PDF metadata is invalid", () => {
    expect(() => MeetingSigningClaimSchema.parse({
      status: "claimed",
      meetingId,
      runId,
      attempt: 1,
      pdfId: "33333333-3333-4333-8333-333333333333",
      pdfPath: "",
      pdfSha256: "NOT-A-SHA",
      pdfSizeBytes: 0,
      documentVersion: 4,
      requestName: "request",
      externalRequestId: null,
    })).toThrow();
  });

  it("requires optimistic versioning and an actor for signing retries", () => {
    expect(RetryMeetingSigningCommandSchema.parse({
      meetingId,
      expectedVersion: 4,
      actorProfileId: eleanorId,
    })).toEqual({ meetingId, expectedVersion: 4, actorProfileId: eleanorId });
    expect(() => RetryMeetingSigningCommandSchema.parse({
      meetingId,
      expectedVersion: 0,
      actorProfileId: "not-a-profile-id",
    })).toThrow();
  });

  it("bounds persisted provider error details", () => {
    expect(MeetingSigningFailureSchema.parse({
      code: "firma_send_failed",
      message: "Firma could not send the signing request.",
    })).toMatchObject({ code: "firma_send_failed" });
    expect(() => MeetingSigningFailureSchema.parse({ code: "", message: "" })).toThrow();
  });
});
