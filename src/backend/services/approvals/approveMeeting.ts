import type { MeetingApprovalRepository } from "../../repositories/approvals/meetingApprovalRepository";
import { supabaseMeetingApprovalRepository } from "../../repositories/supabase/supabaseMeetingApprovalRepository";
import {
  processMeetingPdf,
  type MeetingPdfProcessResult,
} from "../pdf/processMeetingPdf";
import {
  processMeetingSigning,
  type MeetingSigningProcessResult,
} from "../signing/processMeetingSigning";
import {
  ApproveMeetingCommandSchema,
  RetryMeetingPdfCommandSchema,
  type ApproveMeetingCommand,
  type RetryMeetingPdfCommand,
} from "../../../shared/contracts/meetingApproval";

type PdfProcessor = (meetingId: string) => Promise<MeetingPdfProcessResult>;
type SigningProcessor = (meetingId: string) => Promise<MeetingSigningProcessResult>;

export function createMeetingApprovalService({
  repository = supabaseMeetingApprovalRepository,
  processPdf = processMeetingPdf,
  processSigning = processMeetingSigning,
}: {
  repository?: MeetingApprovalRepository;
  processPdf?: PdfProcessor;
  processSigning?: SigningProcessor;
} = {}) {
  async function processPdfAndSigning(meetingId: string) {
    const pdfResult = await processPdf(meetingId);
    if (pdfResult.status === "completed") await processSigning(meetingId);
  }

  return {
    async approveMeeting(command: ApproveMeetingCommand) {
      const validated = ApproveMeetingCommandSchema.parse(command);
      const result = await repository.approve(validated);
      if (result.status === "approved") await processPdfAndSigning(result.meetingId);
      return result;
    },

    async retryMeetingPdf(command: RetryMeetingPdfCommand) {
      const validated = RetryMeetingPdfCommandSchema.parse(command);
      const result = await repository.retryPdf(validated);
      if (result.status === "retry_started") await processPdfAndSigning(result.meetingId);
      return result;
    },
  };
}

export const meetingApprovalService = createMeetingApprovalService();
export const approveMeeting = meetingApprovalService.approveMeeting;
export const retryMeetingPdf = meetingApprovalService.retryMeetingPdf;
