import { describe, expect, it, vi } from "vitest";
import { createManualTranscriptUploadHandler } from "../../src/backend/integrations/transcripts/manualTranscriptUploadHandler";
import { ManualTranscriptUploadError } from "../../src/backend/services/transcripts/processManualTranscriptUpload";

const officer = {
  profileId: "11111111-1111-4111-8111-111111111111",
  displayName: "Board Officer",
  role: "OFFICER" as const,
  isAdmin: false,
};
const member = { ...officer, role: "USER" as const };
const meetingId = "22222222-2222-4222-8222-222222222222";
const validBody = {
  title: "Uploaded board meeting",
  meetingDate: "2026-07-23",
  durationMinutes: 60,
  transcript: "Chair: The meeting is open.",
};

describe("manual transcript upload API", () => {
  it("requires an authenticated reviewer", async () => {
    const processUpload = vi.fn();
    const unauthenticated = createManualTranscriptUploadHandler({
      actorResolver: vi.fn().mockResolvedValue(null),
      processUpload,
    });
    const forbidden = createManualTranscriptUploadHandler({
      actorResolver: vi.fn().mockResolvedValue(member),
      processUpload,
    });

    expect((await unauthenticated(request(validBody))).status).toBe(401);
    expect((await forbidden(request(validBody))).status).toBe(403);
    expect(processUpload).not.toHaveBeenCalled();
  });

  it("validates the upload and passes server-resolved actor attribution to processing", async () => {
    const processUpload = vi.fn().mockResolvedValue({
      status: "pending_approval",
      meetingId,
      analysisAttempt: 1,
    });
    const handler = createManualTranscriptUploadHandler({
      actorResolver: vi.fn().mockResolvedValue(officer),
      processUpload,
    });

    const response = await handler(request(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "pending_approval",
      meetingId,
      analysisAttempt: 1,
    });
    expect(processUpload).toHaveBeenCalledWith(validBody, officer);

    const invalid = await handler(request({ ...validBody, transcript: " " }));
    expect(invalid.status).toBe(400);
    expect(processUpload).toHaveBeenCalledTimes(1);
  });

  it("returns a stable conflict when an upload is duplicated", async () => {
    const handler = createManualTranscriptUploadHandler({
      actorResolver: vi.fn().mockResolvedValue(officer),
      processUpload: vi.fn().mockRejectedValue(new ManualTranscriptUploadError(
        "This manually uploaded transcript has already been imported.",
        "duplicate_upload",
        meetingId,
      )),
    });

    const response = await handler(request(validBody));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "duplicate_upload" },
    });
  });
});

function request(body: unknown) {
  return new Request("https://anda.test/api/transcripts/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
