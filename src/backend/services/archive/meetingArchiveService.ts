import { z } from "zod";
import type { MeetingArchiveRepository } from "../../repositories/archive/meetingArchiveRepository";
import { supabaseMeetingArchiveRepository } from "../../repositories/supabase/supabaseMeetingArchiveRepository";
import { supabaseMinutesPdfStorage } from "../../repositories/supabase/supabaseMinutesPdfStorage";
import type { MeetingArchiveStorage } from "../../repositories/storage/meetingArchiveStorage";
import {
  MeetingArchiveDetailSchema,
  MeetingArchiveQuerySchema,
  type MeetingArchiveQuery,
} from "../../../shared/contracts/meetingArchive";

const DEFAULT_SIGNED_URL_SECONDS = 300;

export function createMeetingArchiveService({
  repository = supabaseMeetingArchiveRepository,
  storage = supabaseMinutesPdfStorage,
  signedUrlSeconds = configuredSignedUrlSeconds(),
}: {
  repository?: MeetingArchiveRepository;
  storage?: MeetingArchiveStorage;
  signedUrlSeconds?: number;
} = {}) {
  const accessLifetime = z.number().int().min(30).max(3_600).parse(signedUrlSeconds);
  return {
    search(query: MeetingArchiveQuery) {
      return repository.search(MeetingArchiveQuerySchema.parse(query));
    },
    async get(meetingId: string) {
      const result = await repository.get(z.string().uuid().parse(meetingId));
      if (result.status === "not_found") return result;
      return {
        status: "available" as const,
        archive: MeetingArchiveDetailSchema.parse({
          meetingId: result.archive.meetingId,
          title: result.archive.title,
          meetingDate: result.archive.meetingDate,
          category: result.archive.category,
          tags: result.archive.tags,
          signedBy: result.archive.signedBy,
          signedAt: result.archive.signedAt,
          signedPdfId: result.archive.signedPdfId,
          completedAt: result.archive.completedAt,
          version: result.archive.version,
          minutes: result.archive.minutes,
          motions: result.archive.motions,
          document: result.archive.document,
        }),
      };
    },
    async createDocumentAccess(meetingId: string) {
      const result = await repository.get(z.string().uuid().parse(meetingId));
      if (result.status === "not_found") return result;
      const access = await storage.createTemporaryDownload(result.archive.storagePath, accessLifetime);
      return {
        status: "available" as const,
        access: {
          meetingId: result.archive.meetingId,
          pdfId: result.archive.document.pdfId,
          url: access.url,
          expiresAt: access.expiresAt,
        },
      };
    },
  };
}

function configuredSignedUrlSeconds() {
  const value = process.env.ARCHIVE_SIGNED_URL_SECONDS;
  if (!value?.trim()) return DEFAULT_SIGNED_URL_SECONDS;
  return Number(value);
}

export const meetingArchiveService = createMeetingArchiveService();
