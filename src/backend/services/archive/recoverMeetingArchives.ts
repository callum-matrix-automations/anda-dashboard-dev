import { z } from "zod";
import type { MeetingArchiveRepository } from "../../repositories/archive/meetingArchiveRepository";
import { supabaseMeetingArchiveRepository } from "../../repositories/supabase/supabaseMeetingArchiveRepository";
import { processMeetingArchive, type MeetingArchiveProcessResult } from "./processMeetingArchive";

export function createMeetingArchiveRecovery({
  repository = supabaseMeetingArchiveRepository,
  processor = processMeetingArchive,
}: {
  repository?: MeetingArchiveRepository;
  processor?: (meetingId: string) => Promise<MeetingArchiveProcessResult>;
} = {}) {
  return async function recoverMeetingArchives(limit = 25) {
    const validatedLimit = z.number().int().min(1).max(100).parse(limit);
    const meetingIds = await repository.listRecoveryCandidates(validatedLimit);
    const results: MeetingArchiveProcessResult[] = [];
    for (const meetingId of meetingIds) results.push(await processor(meetingId));
    return { processed: results.length, results };
  };
}

export const recoverMeetingArchives = createMeetingArchiveRecovery();
