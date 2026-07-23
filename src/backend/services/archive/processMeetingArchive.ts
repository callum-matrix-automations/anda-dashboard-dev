import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { FirmaSigningClientError, firmaSigningClient } from "../../integrations/signing/firmaSigningClient";
import type { SigningRequestProvider } from "../../integrations/signing/signingRequestProvider";
import type { MeetingArchiveRepository } from "../../repositories/archive/meetingArchiveRepository";
import { MeetingArchiveRepositoryError, supabaseMeetingArchiveRepository } from "../../repositories/supabase/supabaseMeetingArchiveRepository";
import { MinutesPdfStorageError, supabaseMinutesPdfStorage } from "../../repositories/supabase/supabaseMinutesPdfStorage";
import type { MeetingArchiveStorage } from "../../repositories/storage/meetingArchiveStorage";
import {
  operationalAlertService,
  safelyRecordOperationalFailure,
  safelyResolveOperationalFailure,
  type OperationalAlertService,
} from "../operations/operationalAlertService";

const DEFAULT_ARCHIVE_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 5_000;

export type MeetingArchiveProcessResult =
  | {
    status: "completed" | "already_completed";
    meetingId: string;
    attempt: number | null;
    signedPdfId: string | null;
  }
  | {
    status: "failed";
    meetingId: string;
    attempt: number;
    error: { code: string; message: string };
  }
  | {
    status: "not_found" | "already_processing" | "protected" | "stale";
    meetingId: string;
    attempt: number | null;
  };

interface Options {
  repository?: MeetingArchiveRepository;
  storage?: MeetingArchiveStorage;
  provider?: SigningRequestProvider;
  retryCount?: number;
  retryDelayMs?: number;
  waitImplementation?: (milliseconds: number) => Promise<void>;
  alerts?: OperationalAlertService;
}

export function createMeetingArchiveProcessor({
  repository = supabaseMeetingArchiveRepository,
  storage = supabaseMinutesPdfStorage,
  provider = firmaSigningClient,
  retryCount = DEFAULT_ARCHIVE_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  waitImplementation = wait,
  alerts,
}: Options = {}) {
  if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 10) {
    throw new Error("Archive retry count must be between zero and ten.");
  }

  return async function processMeetingArchive(meetingId: string): Promise<MeetingArchiveProcessResult> {
    const validatedMeetingId = z.string().uuid().parse(meetingId);
    const claim = await repository.claim(validatedMeetingId);
    if (claim.status !== "claimed") {
      if (claim.status === "already_completed") {
        await safelyResolveOperationalFailure(alerts, {
          stage: "ARCHIVE",
          meetingId: claim.meetingId,
        });
      }
      return {
        status: claim.status,
        meetingId: claim.meetingId,
        attempt: claim.attempt,
        ...(claim.status === "already_completed" ? { signedPdfId: null } : {}),
      } as MeetingArchiveProcessResult;
    }

    let finalError: unknown = new ArchiveProcessingError(
      "Signed PDF archival did not start.",
      "archive_not_started",
    );
    for (let retry = 0; retry <= retryCount; retry += 1) {
      try {
        const document = await provider.downloadCompletedDocument(claim.externalRequestId);
        if (document.isPartial) {
          throw new ArchiveProcessingError(
            "Firma returned a partial document instead of the final signed PDF.",
            "archive_partial_document",
          );
        }
        verifyPdfHeader(document.bytes);
        const sha256 = createHash("sha256").update(document.bytes).digest("hex");
        if (sha256 !== claim.expectedSha256) {
          throw new ArchiveProcessingError(
            "The signed PDF checksum does not match the verified signing outcome.",
            "archive_checksum_mismatch",
          );
        }
        if (document.bytes.byteLength !== claim.expectedSizeBytes) {
          throw new ArchiveProcessingError(
            "The signed PDF size does not match the verified signing outcome.",
            "archive_size_mismatch",
          );
        }

        const pageCount = await readPageCount(document.bytes);
        const stored = await storage.storeSignedPdf({
          meetingId: claim.meetingId,
          documentVersion: claim.documentVersion,
          bytes: document.bytes,
          pageCount,
        });
        if (
          stored.sha256 !== sha256
          || stored.sizeBytes !== document.bytes.byteLength
          || stored.pageCount !== pageCount
        ) {
          throw new ArchiveProcessingError(
            "Supabase returned signed PDF metadata that does not match the uploaded document.",
            "archive_storage_metadata_mismatch",
          );
        }

        await storage.removeObject(claim.unsignedPdfPath);
        const completion = await repository.complete({
          meetingId: claim.meetingId,
          runId: claim.runId,
          storagePath: stored.path,
          sha256: stored.sha256,
          sizeBytes: stored.sizeBytes,
          pageCount: stored.pageCount,
        });
        if (!("signedPdfId" in completion)) {
          return {
            status: completion.status,
            meetingId: completion.meetingId,
            attempt: claim.attempt,
          };
        }
        await safelyResolveOperationalFailure(alerts, {
          stage: "ARCHIVE",
          meetingId: claim.meetingId,
        });
        return {
          status: completion.status,
          meetingId: completion.meetingId,
          attempt: claim.attempt,
          signedPdfId: completion.signedPdfId,
        };
      } catch (error) {
        finalError = error;
        if (retry < retryCount) await waitImplementation(retryDelayMs);
      }
    }

    const failure = sanitiseFailure(finalError);
    const persistence = await repository.recordFailure(claim.meetingId, claim.runId, failure);
    if (persistence.status !== "failed") {
      return {
        status: persistence.status === "already_completed" ? "already_completed" : persistence.status,
        meetingId: persistence.meetingId,
        attempt: claim.attempt,
        ...(persistence.status === "already_completed" ? { signedPdfId: null } : {}),
      } as MeetingArchiveProcessResult;
    }
    await safelyRecordOperationalFailure(alerts, {
      stage: "ARCHIVE",
      meetingId: persistence.meetingId,
      failureCode: failure.code,
      workflowStatus: "ARCHIVE_FAILED",
    });
    return {
      status: "failed",
      meetingId: persistence.meetingId,
      attempt: persistence.attempt,
      error: failure,
    };
  };
}

class ArchiveProcessingError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ArchiveProcessingError";
  }
}

function verifyPdfHeader(bytes: Uint8Array) {
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new ArchiveProcessingError("Firma returned a file that is not a PDF.", "archive_invalid_pdf");
  }
}

async function readPageCount(bytes: Uint8Array) {
  try {
    const document = await PDFDocument.load(bytes);
    const pageCount = document.getPageCount();
    if (pageCount < 1) throw new Error("PDF has no pages.");
    return pageCount;
  } catch (error) {
    throw new ArchiveProcessingError(
      error instanceof Error && error.message === "PDF has no pages."
        ? error.message
        : "The signed document is not a readable PDF.",
      "archive_invalid_pdf",
    );
  }
}

function sanitiseFailure(error: unknown) {
  if (
    error instanceof ArchiveProcessingError
    || error instanceof MinutesPdfStorageError
    || error instanceof MeetingArchiveRepositoryError
    || error instanceof FirmaSigningClientError
  ) {
    return { code: error.code, message: safeMessage(error.message) };
  }
  return {
    code: "archive_failed",
    message: error instanceof Error ? safeMessage(error.message) : "Signed PDF archival failed.",
  };
}

function safeMessage(message: string) {
  const cleaned = message.trim();
  return (cleaned || "Signed PDF archival failed.").slice(0, 2_000);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export const processMeetingArchive = createMeetingArchiveProcessor({ alerts: operationalAlertService });
