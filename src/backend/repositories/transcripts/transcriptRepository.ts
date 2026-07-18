export interface TranscriptImportRecord {
  sourceMeetingId: string;
  title: string;
  meetingDate: string;
  sourceTranscriptId: string;
  content: string;
}

export interface StoredTranscriptImport {
  status: "stored" | "duplicate";
  meetingId: string;
  transcriptId: string;
  importedAt: string;
}

export interface TranscriptRepository {
  storeImport(record: TranscriptImportRecord): Promise<StoredTranscriptImport>;
}
