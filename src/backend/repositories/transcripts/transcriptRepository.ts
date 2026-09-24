export interface TranscriptImportRecord {
  sourceMeetingId: string;
  title: string;
  meetingDate: string;
  durationMinutes: number;
  sourceTranscriptId: string;
  content: string;
  metadata?: Record<string, unknown>;
  attendees: TranscriptImportAttendee[];
}

export interface ActiveMemberProfile {
  profileId: string;
  displayName: string;
  email: string;
}

export interface TranscriptImportAttendee {
  profileId: string | null;
  displayNameSnapshot: string;
  sourceEmailSnapshot: string | null;
}

export interface ManualTranscriptAttendeeLink {
  profileId: string;
  displayNameSnapshot: string;
}

export interface StoredTranscriptImport {
  status: "stored" | "duplicate";
  meetingId: string;
  transcriptId: string;
  importedAt: string;
}

export type TranscriptRenormalizationPersistenceResult = {
  status: "saved" | "not_found" | "forbidden" | "conflict" | "protected";
  version: number | null;
};

export interface TranscriptRepository {
  listActiveMemberProfiles(): Promise<ActiveMemberProfile[]>;
  storeImport(record: TranscriptImportRecord): Promise<StoredTranscriptImport>;
  linkManualAttendees(
    meetingId: string,
    attendees: ManualTranscriptAttendeeLink[],
  ): Promise<number>;
  resolveUnmatchedParticipants(meetingId: string): Promise<number>;
  replaceManualNormalization?(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
    normalization: Record<string, unknown>;
    attendees: TranscriptImportAttendee[];
  }): Promise<TranscriptRenormalizationPersistenceResult>;
}

export interface TranscriptImportFailureRecord {
  sourceProvider: "read_ai";
  sourceMeetingId: string;
  requestId: string | null;
  title: string | null;
  platformMeetingId: string | null;
  errorCode: string;
  errorMessage: string;
  attempts: number;
  failedAt: string;
}

export interface TranscriptImportFailureRepository {
  recordFailure(record: TranscriptImportFailureRecord): Promise<void>;
  resolveFailure(sourceProvider: "read_ai", sourceMeetingId: string, resolvedAt: string): Promise<void>;
}
