import type {
  OperationalAlertDeliveryClaim,
  OperationalAlertInput,
  OperationalAlertRecordResult,
  OperationalAlertStage,
  OperationalIssueReportCommand,
  OperationalIssueReportResult,
} from "../../../shared/contracts/operationalAlerts";
import type { MeetingSigningOutcomeClaim } from "../../../shared/contracts/meetingSigning";

export interface ResolveOperationalAlertInput {
  stage: OperationalAlertStage;
  meetingId?: string | null;
  entityRef?: string | null;
  resolvedAt?: string;
}

export interface OperationalAlertRepository {
  record(input: OperationalAlertInput): Promise<OperationalAlertRecordResult>;
  resolve(input: ResolveOperationalAlertInput): Promise<number>;
  claimDeliveries(limit: number, maxAttempts: number): Promise<OperationalAlertDeliveryClaim[]>;
  completeDelivery(alertId: string, runId: string): Promise<"saved" | "not_found" | "stale">;
  recordDeliveryFailure(
    alertId: string,
    runId: string,
    errorCode: string,
    retryDelaySeconds: number,
    maxAttempts: number,
  ): Promise<"retry_scheduled" | "exhausted" | "not_found" | "stale">;
  createIssueReport(command: OperationalIssueReportCommand): Promise<OperationalIssueReportResult>;
  claimStaleSigningCandidates(
    ageMinutes: number,
    limit: number,
    maxAttempts: number,
  ): Promise<Array<Extract<MeetingSigningOutcomeClaim, { status: "claimed" }>>>;
  listStaleSigningCandidates(ageMinutes: number, limit: number, maxAttempts: number): Promise<string[]>;
}
