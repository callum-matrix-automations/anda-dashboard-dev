import { z } from "zod";
import type { MeetingReviewRepository } from "../../repositories/reviews/meetingReviewRepository";
import { supabaseMeetingReviewRepository } from "../../repositories/supabase/supabaseMeetingReviewRepository";
import { supabaseTranscriptRepository } from "../../repositories/supabase/supabaseTranscriptRepository";
import type { TranscriptRepository } from "../../repositories/transcripts/transcriptRepository";
import { processMeetingAnalysis } from "../ai/processMeetingAnalysis";
import { resolveTranscriptAttendees } from "./matchTranscriptAttendees";
import { normalizeTranscript } from "./normalizeTranscript";
import type { TranscriptNormalizationResult } from "../../../shared/contracts/transcriptNormalization";

const RenormalizeMeetingCommandSchema = z.object({
  meetingId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  actorProfileId: z.string().uuid(),
}).strict();

export type RenormalizeMeetingTranscriptResult = {
  status: "completed" | "analysis_failed" | "not_found" | "forbidden" | "conflict" | "protected";
  meetingId: string;
  version: number | null;
  attempt: number | null;
};

export function createMeetingTranscriptRenormalizer({
  reviews = supabaseMeetingReviewRepository,
  transcripts = supabaseTranscriptRepository,
  normalize = normalizeTranscript,
  analyze = processMeetingAnalysis,
}: {
  reviews?: Pick<MeetingReviewRepository, "getReview">;
  transcripts?: Pick<TranscriptRepository, "listActiveMemberProfiles" | "replaceManualNormalization">;
  normalize?: (content: string) => Promise<TranscriptNormalizationResult>;
  analyze?: typeof processMeetingAnalysis;
} = {}) {
  return async function renormalizeMeetingTranscript(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
  }): Promise<RenormalizeMeetingTranscriptResult> {
    const validated = RenormalizeMeetingCommandSchema.parse(command);
    const meeting = await reviews.getReview(validated.meetingId);
    if (!meeting) return result("not_found", validated.meetingId);
    if (meeting.transcript.metadata.provider !== "manual_upload") {
      return result("protected", validated.meetingId, meeting.version);
    }
    if (!transcripts.replaceManualNormalization) {
      throw new Error("Transcript renormalization persistence is unavailable.");
    }

    const normalization = await normalize(meeting.transcript.content);
    const profiles = await transcripts.listActiveMemberProfiles();
    const genericNames = new Set(normalization.participants
      .filter((participant) => participant.kind === "generic")
      .map((participant) => normalizedName(participant.displayName)));
    const attendees = resolveTranscriptAttendees(
      normalization.participants.map((participant) => ({
        displayName: participant.displayName,
        email: null,
      })),
      profiles,
      { matchByName: true },
    ).map((attendee) => genericNames.has(normalizedName(attendee.displayNameSnapshot))
      ? { ...attendee, profileId: null }
      : attendee);

    const prepared = await transcripts.replaceManualNormalization({
      ...validated,
      normalization: normalizationRecord(normalization),
      attendees,
    });
    if (prepared.status !== "saved") {
      return result(prepared.status, validated.meetingId, prepared.version);
    }

    const analysis = await analyze(validated.meetingId);
    if (analysis.status === "completed") {
      return result("completed", validated.meetingId, null, analysis.attempt);
    }
    if (analysis.status === "failed") {
      return result("analysis_failed", validated.meetingId, null, analysis.attempts);
    }
    return result("protected", validated.meetingId, prepared.version, analysis.attempt);
  };
}

function normalizationRecord(normalization: TranscriptNormalizationResult) {
  return {
    method: normalization.method,
    detectedFormat: normalization.detectedFormat,
    participants: normalization.participants,
    possibleAliases: normalization.possibleAliases,
    warnings: normalization.warnings,
    turnCount: normalization.turnCount,
    attributionCoverage: normalization.attributionCoverage,
    normalizedContent: normalization.canonicalTranscript,
    originalContentHash: normalization.originalContentHash,
    normalizedContentHash: normalization.normalizedContentHash,
    model: normalization.model,
    responseId: normalization.responseId,
    requestId: normalization.requestId,
  };
}

function result(
  status: RenormalizeMeetingTranscriptResult["status"],
  meetingId: string,
  version: number | null = null,
  attempt: number | null = null,
): RenormalizeMeetingTranscriptResult {
  return { status, meetingId, version, attempt };
}

function normalizedName(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-GB");
}

export const renormalizeMeetingTranscript = createMeetingTranscriptRenormalizer();
