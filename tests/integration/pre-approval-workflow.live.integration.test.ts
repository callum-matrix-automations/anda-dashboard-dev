import { describe, expect, it } from "vitest";
import { analyzeMeetingTranscript } from "../../src/backend/services/ai/analyzeMeetingTranscript";
import {
  localSupabaseConfiguration,
  runPreApprovalWorkflow,
} from "./pre-approval-workflow.helpers";

const liveWorkflowConfigured = localSupabaseConfiguration().configured
  && Boolean(process.env.OPENAI_API_KEY?.trim());

describe.skipIf(!liveWorkflowConfigured)("live GPT-5.6 Terra pre-approval workflow", () => {
  it("runs an authenticated transcript webhook through GPT-5.6 Terra to PENDING_APPROVAL", async () => {
    const result = await runPreApprovalWorkflow({
      analyze: analyzeMeetingTranscript,
      idPrefix: "live-gpt56-terra-workflow",
    });

    expect(result.responseStatus).toBe(202);
    expect(result.receipt).toMatchObject({ status: "received" });
    expect(result.meetings).toEqual([expect.objectContaining({
      status: "PENDING_APPROVAL",
      minutes: result.draft.minutes,
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
    expect(result.attendees).toHaveLength(result.draft.attendees.length);
    expect(result.attendees).toHaveLength(5);
    expect(result.motions).toHaveLength(result.draft.motions.length);
    expect(result.votes).toHaveLength(
      result.draft.motions.reduce((total, motion) => total + motion.votes.length, 0),
    );
    expect(result.duplicateResponseStatus).toBe(200);
    expect(result.duplicateReceipt).toMatchObject({ status: "duplicate", attempts: 0 });
    expect(result.duplicateAnalysisStarts).toBe(0);
  }, 150_000);
});
