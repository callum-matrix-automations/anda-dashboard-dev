import { createHash } from "node:crypto";
import { z } from "zod";
import { FirmaSigningClientError, firmaSigningClient } from "../../integrations/signing/firmaSigningClient";
import type { SigningRequestProvider } from "../../integrations/signing/signingRequestProvider";
import type { MeetingSigningRepository } from "../../repositories/signing/meetingSigningRepository";
import type { ApprovedPdfSource } from "../../repositories/storage/approvedPdfSource";
import { supabaseMeetingSigningRepository } from "../../repositories/supabase/supabaseMeetingSigningRepository";
import {
  MinutesPdfStorageError,
  supabaseMinutesPdfStorage,
} from "../../repositories/supabase/supabaseMinutesPdfStorage";
import {
  MeetingSigningFailureSchema,
  SigningRecipientSchema,
  type MeetingSigningFailure,
  type SigningRecipient,
} from "../../../shared/contracts/meetingSigning";
import { TREASURER_SIGNATURE_ANCHOR } from "../pdf/renderMinutesPdf";

export type MeetingSigningProcessResult =
  | {
    status: "completed";
    meetingId: string;
    attempt: number;
    externalRequestId: string;
  }
  | {
    status: "failed";
    meetingId: string;
    attempt: number;
    error: MeetingSigningFailure;
  }
  | {
    status: "not_found" | "already_processing" | "already_completed" | "retry_required" | "protected" | "stale";
    meetingId: string;
    attempt: number | null;
  };

interface MeetingSigningProcessorOptions {
  repository?: MeetingSigningRepository;
  pdfSource?: ApprovedPdfSource;
  provider?: SigningRequestProvider;
  recipient?: SigningRecipient;
}

export function createMeetingSigningProcessor({
  repository = supabaseMeetingSigningRepository,
  pdfSource = supabaseMinutesPdfStorage,
  provider = firmaSigningClient,
  recipient,
}: MeetingSigningProcessorOptions = {}) {
  return async function processMeetingSigning(meetingId: string): Promise<MeetingSigningProcessResult> {
    const parsedMeetingId = z.string().uuid().parse(meetingId);
    const claim = await repository.claimDelivery(parsedMeetingId);
    if (claim.status !== "claimed") {
      return { status: claim.status, meetingId: parsedMeetingId, attempt: claim.attempt };
    }

    try {
      const signingRecipient = recipient ?? resolveTestSigningRecipient();
      const document = await pdfSource.loadApprovedPdf(claim.pdfPath);
      verifyApprovedPdf(document, claim.pdfSha256, claim.pdfSizeBytes);

      let externalRequestId = claim.externalRequestId;
      if (!externalRequestId) {
        const existing = await provider.findRequest(claim.requestName, signingRecipient.email);
        const request = existing ?? await provider.createRequest({
          requestName: claim.requestName,
          description: `Approved ANDA meeting minutes, document version ${claim.documentVersion}.`,
          document,
          recipient: signingRecipient,
          signatureAnchor: TREASURER_SIGNATURE_ANCHOR,
        });
        externalRequestId = request.id;
        const creation = await repository.recordRequestCreated(
          parsedMeetingId,
          claim.runId,
          externalRequestId,
        );
        if (creation !== "saved") {
          if (creation === "not_found" || creation === "stale") {
            return {
              status: creation === "not_found" ? "not_found" : "stale",
              meetingId: parsedMeetingId,
              attempt: claim.attempt,
            };
          }
          throw new MeetingSigningProcessingError(
            "The signing request reference conflicts with the approved PDF.",
            "signing_reference_conflict",
          );
        }
      }

      await provider.sendRequest(externalRequestId);
      const completion = await repository.completeDelivery(parsedMeetingId, claim.runId);
      if (completion !== "saved") {
        return {
          status: completion === "not_found" ? "not_found" : "stale",
          meetingId: parsedMeetingId,
          attempt: claim.attempt,
        };
      }
      return {
        status: "completed",
        meetingId: parsedMeetingId,
        attempt: claim.attempt,
        externalRequestId,
      };
    } catch (error) {
      const failure = sanitiseSigningFailure(error);
      const failureStatus = await repository.recordFailure(
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
      return {
        status: "failed",
        meetingId: parsedMeetingId,
        attempt: claim.attempt,
        error: failure,
      };
    }
  };
}

function resolveTestSigningRecipient(): SigningRecipient {
  return SigningRecipientSchema.parse({
    firstName: process.env.SIGNING_TEST_SIGNER_FIRST_NAME,
    lastName: process.env.SIGNING_TEST_SIGNER_LAST_NAME,
    email: process.env.SIGNING_TEST_SIGNER_EMAIL,
  });
}

function verifyApprovedPdf(document: Uint8Array, expectedSha256: string, expectedSize: number) {
  if (document.byteLength !== expectedSize) {
    throw new MeetingSigningProcessingError(
      "The stored approved PDF size does not match its immutable record.",
      "approved_pdf_size_mismatch",
    );
  }
  const sha256 = createHash("sha256").update(document).digest("hex");
  if (sha256 !== expectedSha256) {
    throw new MeetingSigningProcessingError(
      "The stored approved PDF checksum does not match its immutable record.",
      "approved_pdf_checksum_mismatch",
    );
  }
}

class MeetingSigningProcessingError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "MeetingSigningProcessingError";
    this.code = code;
  }
}

function sanitiseSigningFailure(error: unknown): MeetingSigningFailure {
  let failure: MeetingSigningFailure;
  if (error instanceof FirmaSigningClientError) {
    failure = { code: error.code, message: safeMessage(error.message, "Firma signing failed.") };
  } else if (error instanceof MinutesPdfStorageError) {
    failure = { code: error.code, message: safeMessage(error.message, "Approved PDF retrieval failed.") };
  } else if (error instanceof MeetingSigningProcessingError) {
    failure = { code: error.code, message: safeMessage(error.message, "Signing request processing failed.") };
  } else if (error instanceof z.ZodError) {
    failure = {
      code: "signing_configuration_invalid",
      message: "The configured test signer details are invalid.",
    };
  } else {
    failure = {
      code: "esign_delivery_failed",
      message: error instanceof Error
        ? safeMessage(error.message, "Signing request delivery failed.")
        : "Signing request delivery failed.",
    };
  }
  return MeetingSigningFailureSchema.parse(failure);
}

function safeMessage(value: string, fallback: string): string {
  const message = value.trim();
  return message ? message.slice(0, 2_000) : fallback;
}

export const processMeetingSigning = createMeetingSigningProcessor();
