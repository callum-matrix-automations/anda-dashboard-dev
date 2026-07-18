export interface TranscriptImportRecord {
  sourceMeetingId: string;
  title: string;
  meetingDate: string;
  durationMinutes: number;
  sourceTranscriptId: string;
  content: string;
  attendees: TranscriptImportAttendee[];
}

export interface ActiveMemberProfile {
  profileId: string;
  displayName: string;
}

export interface TranscriptImportAttendee {
  profileId: string;
  displayNameSnapshot: string;
}

export interface StoredTranscriptImport {
  status: "stored" | "duplicate";
  meetingId: string;
  transcriptId: string;
  importedAt: string;
}

export interface TranscriptRepository {
  listActiveMemberProfiles(): Promise<ActiveMemberProfile[]>;
  storeImport(record: TranscriptImportRecord): Promise<StoredTranscriptImport>;
}
