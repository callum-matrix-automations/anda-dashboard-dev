import { createHash } from "node:crypto";
import { z } from "zod";
import { FirmaSigningClientError, firmaSigningClient } from "../../integrations/signing/firmaSigningClient";
import type { SigningRequestProvider } from "../../integrations/signing/signingRequestProvider";
import type { MeetingSigningOutcomeRepository } from "../../repositories/signing/meetingSigningOutcomeRepository";
import { supabaseMeetingSigningOutcomeRepository } from "../../repositories/supabase/supabaseMeetingSigningOutcomeRepository";
import type {
  FirmaRecipient,
  MeetingSigningFailure,
  MeetingSigningOutcomeClaim,
} from "../../../shared/contracts/meetingSigning";
import {
  operationalAlertService,
  safelyRecordOperationalFailure,
  safelyResolveOperationalFailure,
  type OperationalAlertService,
} from "../operations/operationalAlertService";

const IN_PROGRESS_STATUSES = new Set(["not_sent", "sent", "in_progress", "pending"]);
const TERMINAL_FAILURE_STATUSES = new Set(["cancelled", "canceled", "declined", "expired"]);

export type SigningOutcomeProcessResult =
  | {
    status: "ready_for_archive";
    meetingId: string;
    attempt: number;
    documentSha256: string;
    documentSizeBytes: number;
  }
  | {
    status: "no_change";
    meetingId: string;
    attempt: number;
    providerStatus: string;
  }
  | {
    status: "failed";
    meetingId: string;
    attempt: number;
    error: MeetingSigningFailure;
    retryable: boolean;
  }
  | {
    status: "not_found" | "already_processing" | "already_completed" | "protected" | "stale";
    meetingId: string | null;
    attempt: number | null;
  };

interface Options {
  repository?: MeetingSigningOutcomeRepository;
  provider?: SigningRequestProvider;
  signerEmail?: string;
  alerts?: OperationalAlertService;
}

export function createSigningOutcomeProcessor({
  repository = supabaseMeetingSigningOutcomeRepository,
  provider = firmaSigningClient,
  signerEmail,
  alerts,
}: Options = {}) {
  async function processClaim(claim: MeetingSigningOutcomeClaim): Promise<SigningOutcomeProcessResult> {
    if (claim.status !== "claimed") {
      if (claim.status === "already_completed" && "meetingId" in claim && claim.meetingId) {
        await safelyResolveOperationalFailure(alerts, {
          stage: "SIGNING",
          meetingId: claim.meetingId,
        });
      }
      return {
        status: claim.status,
        meetingId: "meetingId" in claim ? claim.meetingId ?? null : null,
        attempt: claim.attempt,
      };
    }

    let providerStatus: string | null = null;
    try {
      const details = await provider.getRequest(claim.externalRequestId);
      providerStatus = details.status.toLocaleLowerCase("en");
      const recipient = findExpectedRecipient(details.recipients, signerEmail ?? configuredSignerEmail());

      if (IN_PROGRESS_STATUSES.has(providerStatus)) {
        const saved = await repository.completeNoChange(claim, {
          providerStatus,
          recipientRef: recipient?.id ?? null,
          recipientEmail: recipient?.email ?? null,
        });
        if (saved !== "saved") return staleResult(saved, claim);
        return {
          status: "no_change",
          meetingId: claim.meetingId,
          attempt: claim.attempt,
          providerStatus,
        };
      }

      if (TERMINAL_FAILURE_STATUSES.has(providerStatus)) {
        return recordFailure(repository, alerts, claim, {
          code: `firma_request_${providerStatus === "canceled" ? "cancelled" : providerStatus}`,
          message: `Firma reports that the signing request is ${providerStatus}.`,
          providerStatus,
          retryable: false,
        });
      }

      if (providerStatus !== "finished" && providerStatus !== "completed") {
        return recordFailure(repository, alerts, claim, {
          code: "firma_unknown_status",
          message: "Firma returned an unsupported signing request status.",
          providerStatus,
          retryable: true,
        });
      }
      if (!recipient?.finishedAt) {
        return recordFailure(repository, alerts, claim, {
          code: "firma_signer_not_completed",
          message: "Firma marked the request complete without confirming the expected signer.",
          providerStatus,
          retryable: true,
        });
      }

      const signedDocument = await provider.downloadCompletedDocument(claim.externalRequestId);
      if (signedDocument.isPartial) {
        return recordFailure(repository, alerts, claim, {
          code: "firma_partial_document",
          message: "Firma returned a partial document instead of the completed signed PDF.",
          providerStatus,
          retryable: true,
        });
      }
      verifyPdf(signedDocument.bytes);
      const sha256 = createHash("sha256").update(signedDocument.bytes).digest("hex");
      const completedAt = details.completedAt ?? recipient.finishedAt ?? signedDocument.generatedAt;
      if (!completedAt) {
        return recordFailure(repository, alerts, claim, {
          code: "firma_completion_time_missing",
          message: "Firma did not provide a completion time for the signed PDF.",
          providerStatus,
          retryable: true,
        });
      }

      const saved = await repository.completeOutcome(claim, {
        providerStatus,
        recipientRef: recipient.id,
        recipientEmail: recipient.email,
        providerCompletedAt: completedAt,
        signedDocumentSha256: sha256,
        signedDocumentSizeBytes: signedDocument.bytes.byteLength,
      });
      if (saved !== "saved") return staleResult(saved, claim);
      await safelyResolveOperationalFailure(alerts, {
        stage: "SIGNING",
        meetingId: claim.meetingId,
      });
      return {
        status: "ready_for_archive",
        meetingId: claim.meetingId,
        attempt: claim.attempt,
        documentSha256: sha256,
        documentSizeBytes: signedDocument.bytes.byteLength,
      };
    } catch (error) {
      const failure = sanitiseFailure(error, providerStatus);
      return recordFailure(repository, alerts, claim, failure);
    }
  }

  return {
    async processWebhookEvent(eventId: string) {
      return processClaim(await repository.claimWebhook(z.string().trim().min(1).parse(eventId)));
    },
    async reconcileMeeting(meetingId: string) {
      const validatedMeetingId = z.string().uuid().parse(meetingId);
      return processClaim(await repository.claimReconciliation(validatedMeetingId));
    },
    processClaim,
  };
}

function configuredSignerEmail(): string {
  return z.string().trim().email().parse(process.env.SIGNING_TEST_SIGNER_EMAIL);
}

function findExpectedRecipient(recipients: FirmaRecipient[], signerEmail: string) {
  const email = signerEmail.toLocaleLowerCase("en");
  return recipients.find((recipient) => recipient.email.toLocaleLowerCase("en") === email) ?? null;
}

function verifyPdf(bytes: Uint8Array) {
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new SigningOutcomeError("Firma returned a file that is not a PDF.", "firma_invalid_pdf");
  }
}

class SigningOutcomeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SigningOutcomeError";
  }
}

function sanitiseFailure(error: unknown, providerStatus: string | null) {
  if (error instanceof FirmaSigningClientError) {
    return {
      code: error.code,
      message: safeMessage(error.message, "Firma signing completion failed."),
      providerStatus,
      retryable: !error.status || error.status >= 500 || error.status === 429,
    };
  }
  if (error instanceof SigningOutcomeError) {
    return { code: error.code, message: error.message, providerStatus, retryable: true };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "signing_configuration_invalid",
      message: "The configured signer or Firma response is invalid.",
      providerStatus,
      retryable: false,
    };
  }
  return {
    code: "esign_completion_failed",
    message: error instanceof Error
      ? safeMessage(error.message, "Signing completion failed.")
      : "Signing completion failed.",
    providerStatus,
    retryable: true,
  };
}

async function recordFailure(
  repository: MeetingSigningOutcomeRepository,
  alerts: OperationalAlertService | undefined,
  claim: Extract<MeetingSigningOutcomeClaim, { status: "claimed" }>,
  failure: MeetingSigningFailure & { providerStatus: string | null; retryable: boolean },
): Promise<SigningOutcomeProcessResult> {
  const persistence = await repository.recordOutcomeFailure(claim, failure);
  if (persistence !== "failed") return staleResult(persistence, claim);
  if (!failure.retryable) {
    await safelyRecordOperationalFailure(alerts, {
      stage: "SIGNING",
      meetingId: claim.meetingId,
      failureCode: failure.code,
      workflowStatus: "ESIGN_FAILED",
    });
  }
  return {
    status: "failed",
    meetingId: claim.meetingId,
    attempt: claim.attempt,
    error: { code: failure.code, message: failure.message },
    retryable: failure.retryable,
  };
}

function staleResult(
  status: "not_found" | "stale",
  claim: Extract<MeetingSigningOutcomeClaim, { status: "claimed" }>,
): SigningOutcomeProcessResult {
  return {
    status,
    meetingId: claim.meetingId,
    attempt: claim.attempt,
  };
}

function safeMessage(value: string, fallback: string) {
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, 2_000) : fallback;
}

export const signingOutcomeProcessor = createSigningOutcomeProcessor({ alerts: operationalAlertService });
export const processFirmaWebhookEvent = signingOutcomeProcessor.processWebhookEvent;
export const reconcileMeetingSigning = signingOutcomeProcessor.reconcileMeeting;
