export interface StoreUnsignedMinutesPdfInput {
  meetingId: string;
  documentVersion: number;
  bytes: Uint8Array;
  pageCount: number;
}

export interface StoredUnsignedMinutesPdf {
  path: string;
  sha256: string;
  sizeBytes: number;
  pageCount: number;
}

export interface MinutesPdfStorage {
  storeUnsignedPdf(input: StoreUnsignedMinutesPdfInput): Promise<StoredUnsignedMinutesPdf>;
}
