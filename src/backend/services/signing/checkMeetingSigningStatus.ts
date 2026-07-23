import type { MeetingReviewDetail } from "../../../shared/contracts/meetingReview";
import {
  RetryMeetingSigningCommandSchema,
  type RetryMeetingSigningCommand,
} from "../../../shared/contracts/meetingSigning";
import { meetingReviewService } from "../reviews/meetingReviewService";
import {
  reconcileMeetingSigning,
  type SigningOutcomeProcessResult,
} from "./processSigningOutcome";

export type CheckMeetingSigningStatusResult =
  | {
    status: "checked";
    meetingId: string;
    version: number;
    attempt: number | null;
    reconciliation: SigningOutcomeProcessResult;
  }
  | {
    status: "not_found" | "conflict" | "invalid_state";
    meetingId: string;
    version: number | null;
  };

export function createCheckMeetingSigningStatusService({
  getMeeting = meetingReviewService.getMeetingReview,
  reconcile = reconcileMeetingSigning,
}: {
  getMeeting?: (meetingId: string) => Promise<MeetingReviewDetail | null>;
  reconcile?: (meetingId: string) => Promise<SigningOutcomeProcessResult>;
} = {}) {
  return async function checkMeetingSigningStatus(
    command: RetryMeetingSigningCommand,
  ): Promise<CheckMeetingSigningStatusResult> {
    const validated = RetryMeetingSigningCommandSchema.parse(command);
    const meeting = await getMeeting(validated.meetingId);
    if (!meeting) {
      return {
        status: "not_found",
        meetingId: validated.meetingId,
        version: null,
      };
    }
    if (meeting.version !== validated.expectedVersion) {
      return {
        status: "conflict",
        meetingId: validated.meetingId,
        version: meeting.version,
      };
    }
    if (meeting.status !== "AWAITING_SIGNATURE") {
      return {
        status: "invalid_state",
        meetingId: validated.meetingId,
        version: meeting.version,
      };
    }

    const reconciliation = await reconcile(validated.meetingId);
    if (reconciliation.status === "not_found") {
      return {
        status: "not_found",
        meetingId: validated.meetingId,
        version: meeting.version,
      };
    }
    if (reconciliation.status === "protected" || reconciliation.status === "stale") {
      return {
        status: "invalid_state",
        meetingId: validated.meetingId,
        version: meeting.version,
      };
    }
    return {
      status: "checked",
      meetingId: validated.meetingId,
      version: meeting.version,
      attempt: reconciliation.attempt,
      reconciliation,
    };
  };
}

export const checkMeetingSigningStatus = createCheckMeetingSigningStatusService();
