import { describe, expect, it, vi } from "vitest";
import {
  loadPredefinedMeetingDraft,
  localSupabaseConfiguration,
  runPreApprovalWorkflow,
} from "./pre-approval-workflow.helpers";

const localIntegrationConfigured = localSupabaseConfiguration().configured;

describe.skipIf(!localIntegrationConfigured)("pre-approval workflow with a predefined AI response", () => {
  it("runs an authenticated transcript webhook through to an idempotent PENDING_APPROVAL draft", async () => {
    const predefinedDraft = await loadPredefinedMeetingDraft();
    const analyze = vi.fn().mockResolvedValue(predefinedDraft);

    const result = await runPreApprovalWorkflow({
      analyze,
      idPrefix: "predefined-workflow",
    });

    expect(result.responseStatus).toBe(202);
    expect(result.receipt).toMatchObject({
      status: "received",
      sourceMeetingId: result.packet.meeting.sourceMeetingId,
      sourceTranscriptId: result.packet.transcript.sourceTranscriptId,
    });
    expect(analyze).toHaveBeenCalledOnce();
    expect(result.analysisInput).toMatchObject({
      meeting: {
        sourceMeetingId: result.packet.meeting.sourceMeetingId,
        durationMinutes: 90,
      },
      transcript: {
        language: "und",
        content: result.packet.transcript.content,
      },
    });
    expect(result.analysisInput.participants).toHaveLength(5);

    expect(result.meetings).toEqual([expect.objectContaining({
      status: "PENDING_APPROVAL",
      minutes: predefinedDraft.minutes,
      analysis_attempt: 1,
      analysis_run_id: null,
      human_owned: false,
      last_error_code: null,
    })]);
    expect(result.transcripts).toEqual([expect.objectContaining({
      meeting_id: result.meetings[0]?.id,
      source_transcript_id: result.packet.transcript.sourceTranscriptId,
      content: result.packet.transcript.content,
    })]);
    expect(result.attendees).toHaveLength(predefinedDraft.attendees.length);
    expect(result.motions).toHaveLength(predefinedDraft.motions.length);
    expect(result.votes).toHaveLength(
      predefinedDraft.motions.reduce((total, motion) => total + motion.votes.length, 0),
    );
    expect(result.motions.map((motion) => motion.outcome)).toEqual(expect.arrayContaining([
      "CARRIED",
      "FAILED",
      "TABLED",
      null,
    ]));

    expect(result.duplicateResponseStatus).toBe(200);
    expect(result.duplicateReceipt).toMatchObject({ status: "duplicate", attempts: 0 });
    expect(result.duplicateAnalysisStarts).toBe(0);
  }, 30_000);
});
