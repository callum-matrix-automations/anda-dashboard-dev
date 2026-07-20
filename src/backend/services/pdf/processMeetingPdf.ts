import { z } from "zod";
import type { MeetingApprovalRepository } from "../../repositories/approvals/meetingApprovalRepository";
import { supabaseMeetingApprovalRepository } from "../../repositories/supabase/supabaseMeetingApprovalRepository";
import { MinutesPdfStorageError, supabaseMinutesPdfStorage } from "../../repositories/supabase/supabaseMinutesPdfStorage";
import type { MinutesPdfStorage } from "../../repositories/storage/minutesPdfStorage";
import { buildMinutesDocument } from "./buildMinutesDocument";
import { renderMinutesPdf } from "./renderMinutesPdf";
import {
  operationalAlertService,
  safelyRecordOperationalFailure,
  safelyResolveOperationalFailure,
  type OperationalAlertService,
} from "../operations/operationalAlertService";

export type MeetingPdfProcessResult =
  | { status: "completed"; meetingId: string; attempt: number; path: string }
  | { status: "failed"; meetingId: string; attempt: number; error: { code: string; message: string } }
  | { status: "not_found" | "already_processing" | "already_completed" | "retry_required" | "protected" | "stale"; meetingId: string; attempt: number | null };

interface MeetingPdfProcessorOptions {
  repository?: MeetingApprovalRepository;
  storage?: MinutesPdfStorage;
  render?: typeof renderMinutesPdf;
  alerts?: OperationalAlertService;
}

export function createMeetingPdfProcessor({
  repository = supabaseMeetingApprovalRepository,
  storage = supabaseMinutesPdfStorage,
  render = renderMinutesPdf,
  alerts,
}: MeetingPdfProcessorOptions = {}) {
  return async function processMeetingPdf(meetingId: string): Promise<MeetingPdfProcessResult> {
    const parsedMeetingId = z.string().uuid().parse(meetingId);
    const claim = await repository.claimPdfGeneration(parsedMeetingId);
    if (claim.status !== "claimed") {
      return { status: claim.status, meetingId: parsedMeetingId, attempt: claim.attempt };
    }

    try {
      const model = buildMinutesDocument(claim.snapshot);
      const rendered = await render(model);
      const stored = await storage.storeUnsignedPdf({
        meetingId: parsedMeetingId,
        documentVersion: claim.documentVersion,
        bytes: rendered.bytes,
        pageCount: rendered.pageCount,
      });
      const completion = await repository.completePdfGeneration(parsedMeetingId, claim.runId, stored);
      if (completion !== "saved") {
        return {
          status: completion === "not_found" ? "not_found" : "stale",
          meetingId: parsedMeetingId,
          attempt: claim.attempt,
        };
      }
      await safelyResolveOperationalFailure(alerts, {
        stage: "PDF_GENERATION",
        meetingId: parsedMeetingId,
      });
      return {
        status: "completed",
        meetingId: parsedMeetingId,
        attempt: claim.attempt,
        path: stored.path,
      };
    } catch (error) {
      const failure = sanitisePdfFailure(error);
      const failureStatus = await repository.recordPdfFailure(
        parsedMeetingId,
        claim.runId,
        failure,
      );
      if (failureStatus !== "failed") {
        return {
          status: failureStatus === "not_found" ? "not_found" : "stale",
          meetingId: parsedMeetingId,
          attempt: claim.attempt,
        };
      }
      await safelyRecordOperationalFailure(alerts, {
        stage: "PDF_GENERATION",
        meetingId: parsedMeetingId,
        failureCode: failure.code,
        workflowStatus: "PDF_FAILED",
      });
      return {
        status: "failed",
        meetingId: parsedMeetingId,
        attempt: claim.attempt,
        error: failure,
      };
    }
  };
}

function sanitisePdfFailure(error: unknown): { code: string; message: string } {
  if (error instanceof MinutesPdfStorageError) {
    return { code: error.code, message: safeMessage(error.message, "PDF storage failed.") };
  }
  if (error instanceof z.ZodError) {
    return { code: "invalid_approved_snapshot", message: "The approved meeting snapshot is invalid." };
  }
  return {
    code: "pdf_generation_failed",
    message: error instanceof Error
      ? safeMessage(error.message, "PDF generation failed.")
      : "PDF generation failed.",
  };
}

function safeMessage(value: string, fallback: string): string {
  const message = value.trim();
  return message ? message.slice(0, 2_000) : fallback;
}

export const processMeetingPdf = createMeetingPdfProcessor({ alerts: operationalAlertService });
