import { z } from "zod";
import { firmaSigningClient } from "../../integrations/signing/firmaSigningClient";
import type { SigningRequestProvider } from "../../integrations/signing/signingRequestProvider";
import type { MeetingSigningOutcomeRepository } from "../../repositories/signing/meetingSigningOutcomeRepository";
import { supabaseMeetingSigningOutcomeRepository } from "../../repositories/supabase/supabaseMeetingSigningOutcomeRepository";
import { MeetingSigningSessionSchema } from "../../../shared/contracts/meetingSigning";

export function createMeetingSigningSessionRecordService({
  repository = supabaseMeetingSigningOutcomeRepository,
}: {
  repository?: MeetingSigningOutcomeRepository;
} = {}) {
  return async function getMeetingSigningSessionRecord(meetingId: string) {
    return repository.getSession(z.string().uuid().parse(meetingId));
  };
}

export function createMeetingSigningSessionService({
  repository = supabaseMeetingSigningOutcomeRepository,
  provider = firmaSigningClient,
  signerEmail,
  signingAppUrl = "https://app.firma.dev/signing/",
}: {
  repository?: MeetingSigningOutcomeRepository;
  provider?: SigningRequestProvider;
  signerEmail?: string;
  signingAppUrl?: string;
} = {}) {
  return async function getMeetingSigningSession(meetingId: string) {
    const validatedMeetingId = z.string().uuid().parse(meetingId);
    const record = await repository.getSession(validatedMeetingId);
    if (record.status !== "available") return record;

    const expectedEmail = z.string().trim().email().parse(
      signerEmail ?? process.env.SIGNING_TEST_SIGNER_EMAIL,
    );
    const details = await provider.getRequest(record.externalRequestId);
    const recipient = details.recipients.find(
      (candidate) => candidate.email.toLocaleLowerCase("en") === expectedEmail.toLocaleLowerCase("en"),
    );
    if (!recipient) {
      throw new Error("The configured Treasurer is not a recipient of this signing request.");
    }

    return MeetingSigningSessionSchema.parse({
      status: "available",
      meetingId: record.meetingId,
      requestId: record.requestId,
      externalRequestId: record.externalRequestId,
      documentVersion: record.documentVersion,
      outcomeStatus: record.outcomeStatus,
      providerStatus: details.status,
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      signingUrl: new URL(encodeURIComponent(recipient.id), ensureTrailingSlash(signingAppUrl)).href,
    });
  };
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

export const getMeetingSigningSessionRecord = createMeetingSigningSessionRecordService();
export const getMeetingSigningSession = createMeetingSigningSessionService();
