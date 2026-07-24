import { z } from "zod";
import type { MeetingReviewDetail } from "../../../shared/contracts/meetingReview";
import type { MeetingApiDetail } from "../../../shared/contracts/meetingApi";
import { normalizeProfileEmail } from "../../../shared/schemas/profileEmail";

const SourceMetadataSchema = z.object({
  startTime: z.string().datetime({ offset: true }).optional(),
  endTime: z.string().datetime({ offset: true }).optional(),
  participants: z.array(z.object({
    name: z.string(),
    email: z.string().nullable().optional(),
  }).passthrough()).max(1_000).optional(),
}).passthrough();

type MeetingApiSourceFields = Pick<MeetingApiDetail, "source" | "sourceParticipants">;

export function mapMeetingApiSource(meeting: MeetingReviewDetail): MeetingApiSourceFields {
  const parsedMetadata = SourceMetadataSchema.safeParse(meeting.transcript.metadata);
  const metadata = parsedMetadata.success ? parsedMetadata.data : null;
  const matchedByEmail = new Map(
    meeting.attendees.flatMap((attendee) => {
      const email = normalizeProfileEmail(attendee.sourceEmailSnapshot);
      const linkedProfileId = attendee.linkedProfileId === undefined
        ? attendee.profileId
        : attendee.linkedProfileId;
      return email && linkedProfileId
        ? [[email, { ...attendee, profileId: linkedProfileId }] as const]
        : [];
    }),
  );
  const sourceParticipants = mapSourceParticipants(metadata?.participants ?? [], matchedByEmail);

  return {
    source: {
      sourceMeetingId: meeting.sourceMeetingId,
      startedAt: metadata?.startTime ?? null,
      endedAt: metadata?.endTime ?? null,
      durationMinutes: meeting.durationMinutes,
      importedAt: meeting.transcript.importedAt,
    },
    sourceParticipants: sourceParticipants.length > 0
      ? sourceParticipants
      : meeting.attendees.map((attendee) => ({
        displayName: attendee.displayName,
        email: normalizeProfileEmail(attendee.sourceEmailSnapshot),
        profileId: attendee.linkedProfileId === undefined
          ? attendee.profileId
          : attendee.linkedProfileId,
        matchStatus: (
          attendee.linkedProfileId === undefined
            ? attendee.profileId
            : attendee.linkedProfileId
        )
          ? "matched" as const
          : "unmatched" as const,
      })),
  };
}

function mapSourceParticipants(
  participants: Array<{ name: string; email?: string | null }>,
  matchedByEmail: Map<string, MeetingReviewDetail["attendees"][number]>,
) {
  const seen = new Set<string>();
  return participants.flatMap((participant) => {
    const displayName = participant.name.trim().replace(/\s+/gu, " ");
    if (!displayName) return [];
    const email = normalizeProfileEmail(participant.email);
    const key = email
      ? `email:${email}`
      : `name:${displayName.toLocaleLowerCase("en-GB")}`;
    if (seen.has(key)) return [];
    seen.add(key);

    const matched = email ? matchedByEmail.get(email) : undefined;
    return [{
      displayName,
      email,
      profileId: matched?.profileId ?? null,
      matchStatus: matched ? "matched" as const : "unmatched" as const,
    }];
  });
}
