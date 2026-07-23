import type { OperationalAlertDeliveryClaim } from "../../../shared/contracts/operationalAlerts";

export interface OperationalAlertProvider {
  isConfigured(): boolean;
  send(alert: OperationalAlertDeliveryClaim): Promise<void>;
}
