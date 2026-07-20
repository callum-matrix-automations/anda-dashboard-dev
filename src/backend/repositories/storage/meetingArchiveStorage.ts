export interface StoreSignedMeetingPdfInput {
  meetingId: string;
  documentVersion: number;
  bytes: Uint8Array;
  pageCount: number;
}

export interface StoredSignedMeetingPdf {
  path: string;
  sha256: string;
  sizeBytes: number;
  pageCount: number;
}

export interface TemporaryDocumentAccess {
  url: string;
  expiresAt: string;
}

export interface MeetingArchiveStorage {
  storeSignedPdf(input: StoreSignedMeetingPdfInput): Promise<StoredSignedMeetingPdf>;
  removeObject(path: string): Promise<void>;
  createTemporaryDownload(path: string, expiresInSeconds: number): Promise<TemporaryDocumentAccess>;
}
