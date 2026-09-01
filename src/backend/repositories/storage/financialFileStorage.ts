import type { FinancialRecordMimeType } from "../../../shared/contracts/financial";

export interface FinancialFileStorage {
  store(input: {
    path: string;
    bytes: Uint8Array;
    mimeType: FinancialRecordMimeType;
  }): Promise<{ path: string }>;
  load(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}
