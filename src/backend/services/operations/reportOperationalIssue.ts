import type { OperationalAlertRepository } from "../../repositories/operations/operationalAlertRepository";
import { supabaseOperationalAlertRepository } from "../../repositories/supabase/supabaseOperationalAlertRepository";
import {
  OperationalIssueReportCommandSchema,
  type OperationalIssueReportCommand,
} from "../../../shared/contracts/operationalAlerts";

export function createOperationalIssueReporter(
  repository: OperationalAlertRepository = supabaseOperationalAlertRepository,
) {
  return function reportOperationalIssue(command: OperationalIssueReportCommand) {
    return repository.createIssueReport(OperationalIssueReportCommandSchema.parse(command));
  };
}

export const reportOperationalIssue = createOperationalIssueReporter();
