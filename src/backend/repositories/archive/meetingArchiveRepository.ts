import type {
  MeetingArchiveClaim,
  MeetingArchiveCompletion,
  MeetingArchiveDetail,
  MeetingArchiveFailurePersistence,
  MeetingArchiveQuery,
  MeetingArchiveSearchResult,
} from "../../../shared/contracts/meetingArchive";

export interface CompleteMeetingArchiveInput {
  meetingId: string;
  runId: string;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  pageCount: number;
}

export interface MeetingArchiveFailure {
  code: string;
  message: string;
}

export interface StoredMeetingArchiveDetail extends MeetingArchiveDetail {
  storagePath: string;
}

export type StoredMeetingArchiveResult =
  | { status: "available"; archive: StoredMeetingArchiveDetail }
  | { status: "not_found"; meetingId: string };

export interface MeetingArchiveRepository {
  claim(meetingId: string): Promise<MeetingArchiveClaim>;
  complete(input: CompleteMeetingArchiveInput): Promise<MeetingArchiveCompletion>;
  recordFailure(
    meetingId: string,
    runId: string,
    failure: MeetingArchiveFailure,
  ): Promise<MeetingArchiveFailurePersistence>;
  listRecoveryCandidates(limit: number): Promise<string[]>;
  search(query: MeetingArchiveQuery): Promise<MeetingArchiveSearchResult>;
  get(meetingId: string): Promise<StoredMeetingArchiveResult>;
}
