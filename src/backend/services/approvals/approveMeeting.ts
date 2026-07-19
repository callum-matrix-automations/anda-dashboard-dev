import type { MeetingApprovalRepository } from "../../repositories/approvals/meetingApprovalRepository";
import { supabaseMeetingApprovalRepository } from "../../repositories/supabase/supabaseMeetingApprovalRepository";
import {
  processMeetingPdf,
  type MeetingPdfProcessResult,
} from "../pdf/processMeetingPdf";
import {
  ApproveMeetingCommandSchema,
  RetryMeetingPdfCommandSchema,
  type ApproveMeetingCommand,
  type RetryMeetingPdfCommand,
} from "../../../shared/contracts/meetingApproval";

type PdfProcessor = (meetingId: string) => Promise<MeetingPdfProcessResult>;

export function createMeetingApprovalService({
  repository = supabaseMeetingApprovalRepository,
  processPdf = processMeetingPdf,
}: {
  repository?: MeetingApprovalRepository;
  processPdf?: PdfProcessor;
} = {}) {
  return {
    async approveMeeting(command: ApproveMeetingCommand) {
      const validated = ApproveMeetingCommandSchema.parse(command);
      const result = await repository.approve(validated);
      if (result.status === "approved") await processPdf(result.meetingId);
      return result;
    },

    async retryMeetingPdf(command: RetryMeetingPdfCommand) {
      const validated = RetryMeetingPdfCommandSchema.parse(command);
      const result = await repository.retryPdf(validated);
      if (result.status === "retry_started") await processPdf(result.meetingId);
      return result;
    },
  };
}

export const meetingApprovalService = createMeetingApprovalService();
export const approveMeeting = meetingApprovalService.approveMeeting;
export const retryMeetingPdf = meetingApprovalService.retryMeetingPdf;
