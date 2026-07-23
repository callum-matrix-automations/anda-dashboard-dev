import { describe, expect, it, vi } from "vitest";
import {
  createManualTranscriptUploadProcessor,
  extractTranscriptSpeakers,
} from "../../src/backend/services/transcripts/processManualTranscriptUpload";

const actor = {
  profileId: "11111111-1111-4111-8111-111111111111",
  displayName: "Board Officer",
  role: "OFFICER" as const,
  isAdmin: false,
};
const meetingId = "22222222-2222-4222-8222-222222222222";
const transcriptId = "33333333-3333-4333-8333-333333333333";
const uploadId = "44444444-4444-4444-8444-444444444444";

describe("manual transcript upload", () => {
  it("stores an attributed transcript and runs analysis synchronously to pending approval", async () => {
    const store = vi.fn().mockResolvedValue({
      status: "stored",
      meetingId,
      transcriptId,
      importedAt: "2026-07-23T12:00:00.000Z",
    });
    const analyze = vi.fn().mockResolvedValue({
      status: "completed",
      meetingId,
      attempt: 1,
    });
    const processUpload = createManualTranscriptUploadProcessor({
      store,
      analyze,
      now: () => new Date("2026-07-23T12:00:00.000Z"),
      createId: () => uploadId,
    });

    await expect(processUpload({
      title: "Uploaded governance meeting",
      meetingDate: "2026-07-22",
      durationMinutes: 75,
      transcript: [
        "Eleanor Hughes: Welcome to the meeting.",
        "Marcus Patel: I second the motion.",
        "Eleanor Hughes: The motion is carried.",
      ].join("\n"),
    }, actor)).resolves.toEqual({
      status: "pending_approval",
      meetingId,
      analysisAttempt: 1,
    });

    expect(store).toHaveBeenCalledWith(expect.objectContaining({
      eventId: `manual:${uploadId}`,
      meeting: expect.objectContaining({
        sourceMeetingId: `manual:${uploadId}`,
        title: "Uploaded governance meeting",
        durationMinutes: 75,
      }),
      attendees: [
        { displayName: "Eleanor Hughes", email: null },
        { displayName: "Marcus Patel", email: null },
      ],
      transcript: expect.objectContaining({
        sourceTranscriptId: `manual:${uploadId}`,
        content: expect.stringContaining("motion is carried"),
        metadata: expect.objectContaining({
          provider: "manual_upload",
          uploadedBy: {
            profileId: actor.profileId,
            displayName: actor.displayName,
          },
        }),
      }),
    }));
    expect(analyze).toHaveBeenCalledWith(meetingId);
  });

  it("returns the saved meeting when GPT analysis exhausts its retries", async () => {
    const processUpload = createManualTranscriptUploadProcessor({
      store: vi.fn().mockResolvedValue({
        status: "stored",
        meetingId,
        transcriptId,
        importedAt: "2026-07-23T12:00:00.000Z",
      }),
      analyze: vi.fn().mockResolvedValue({
        status: "failed",
        meetingId,
        attempts: 3,
        error: { code: "invalid_model_output", message: "The model output was invalid." },
      }),
      createId: () => uploadId,
    });

    await expect(processUpload({
      title: "Uploaded governance meeting",
      meetingDate: "2026-07-22",
      durationMinutes: 60,
      transcript: "Chair: The meeting is open.",
    }, actor)).resolves.toEqual({
      status: "ai_failed",
      meetingId,
      analysisAttempts: 3,
      error: { code: "invalid_model_output", message: "The model output was invalid." },
    });
  });

  it("deduplicates speaker names without treating indented dialogue as a new speaker", () => {
    expect(extractTranscriptSpeakers([
      "Chair: Welcome.",
      "Member 1: Thank you.",
      "Chair: Next item.",
      "  Not a speaker: This line is indented.",
    ].join("\n"))).toEqual(["Chair", "Member 1"]);
  });
});
