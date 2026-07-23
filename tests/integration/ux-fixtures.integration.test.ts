import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createSupabaseMeetingAnalysisRepository } from "../../src/backend/repositories/supabase/supabaseMeetingAnalysisRepository";
import { createSupabaseMeetingApprovalRepository } from "../../src/backend/repositories/supabase/supabaseMeetingApprovalRepository";
import { createSupabaseMeetingArchiveRepository } from "../../src/backend/repositories/supabase/supabaseMeetingArchiveRepository";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";
import { createSupabaseMeetingSigningOutcomeRepository } from "../../src/backend/repositories/supabase/supabaseMeetingSigningOutcomeRepository";
import { createSupabaseMeetingSigningRepository } from "../../src/backend/repositories/supabase/supabaseMeetingSigningRepository";
import { createSupabaseMinutesPdfStorage } from "../../src/backend/repositories/supabase/supabaseMinutesPdfStorage";
import { createSupabaseTranscriptRepository } from "../../src/backend/repositories/supabase/supabaseTranscriptRepository";
import { createMeetingApprovalService } from "../../src/backend/services/approvals/approveMeeting";
import { createMeetingArchiveProcessor } from "../../src/backend/services/archive/processMeetingArchive";
import { createMeetingPdfProcessor } from "../../src/backend/services/pdf/processMeetingPdf";
import { createMeetingReviewService } from "../../src/backend/services/reviews/meetingReviewService";
import { createMeetingSigningProcessor } from "../../src/backend/services/signing/processMeetingSigning";
import { createSigningOutcomeProcessor } from "../../src/backend/services/signing/processSigningOutcome";
import { createTranscriptImportStore } from "../../src/backend/services/transcripts/storeTranscriptImport";
import {
  MeetingDraftSchema,
  type MeetingDraft,
} from "../../src/shared/contracts/meetingAnalysis";
import type { MeetingReviewDraft } from "../../src/shared/contracts/meetingReview";
import {
  TranscriptWebhookPacketSchema,
  type TranscriptWebhookPacket,
} from "../../src/shared/contracts/transcriptWebhook";
import { FakeSigningProvider } from "../helpers/fakeSigningProvider";

const apiUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const localIntegrationConfigured = isLoopbackUrl(apiUrl)
  && Boolean(secretKey)
  && !secretKey.startsWith("replace-");

const profiles = {
  eleanor: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Eleanor Hughes",
    email: "eleanor.hughes@example.test",
  },
  marcus: {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Marcus Patel",
    email: "marcus.patel@example.test",
  },
  priya: {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Priya Shah",
    email: "priya.shah@example.test",
  },
  daniel: {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Daniel Brooks",
    email: "daniel.brooks@example.test",
  },
  amelia: {
    id: "10000000-0000-4000-8000-000000000005",
    name: "Amelia Clarke",
    email: "amelia.clarke@example.test",
  },
} as const;

describe.skipIf(!localIntegrationConfigured)("manual UX fixture seed", () => {
  it("creates exactly one review, one analysis-failure, and one completed archive meeting", async () => {
    const existingMeetings = await selectRows<{ id: string }>("meetings", "id");
    if (existingMeetings.length > 0) {
      throw new Error(
        "UX fixtures require an empty meetings table. Run npm.cmd run supabase:reset before seeding.",
      );
    }

    const longTranscript = await readFile("fixtures/transcripts/anda-board-meeting.txt", "utf8");

    const reviewMeeting = await createAnalyzedMeeting({
      key: "ux-review-community-projects",
      title: "July Community Projects Meeting",
      startedAt: "2026-07-18T18:00:00.000Z",
      endedAt: "2026-07-18T19:25:00.000Z",
      attendees: [
        profiles.eleanor,
        profiles.marcus,
        profiles.priya,
        profiles.daniel,
        profiles.amelia,
        { name: "Sofia Turner", email: "sofia.turner@external.example.test" },
      ],
      transcript: longTranscript,
      draft: reviewMeetingDraft(),
      tags: ["ux-review", "community", "capital-works"],
    });

    const failedMeeting = await createFailedMeeting({
      key: "ux-failed-drainage-review",
      title: "Emergency Drainage Review",
      startedAt: "2026-07-21T08:30:00.000Z",
      endedAt: "2026-07-21T09:00:00.000Z",
      attendees: [profiles.eleanor, profiles.marcus, profiles.daniel],
      transcript: [
        "Eleanor Hughes: We need to document the blocked stormwater drain and agree the immediate inspection scope.",
        "Marcus Patel: The contractor photographs and cost estimate have not yet arrived.",
        "Daniel Brooks: The western courtyard flooded during the last storm.",
      ].join("\n\n"),
    });

    const completedMeeting = await createAnalyzedMeeting({
      key: "ux-archive-annual-budget",
      title: "2026 Annual Budget Meeting",
      startedAt: "2026-06-30T17:30:00.000Z",
      endedAt: "2026-06-30T18:35:00.000Z",
      attendees: [profiles.eleanor, profiles.marcus, profiles.priya],
      transcript: [
        "Eleanor Hughes: The annual budget includes the heritage roof renewal and the updated reserve contribution.",
        "Marcus Patel: I move that the 2026 annual budget be adopted.",
        "Priya Shah: I second the motion. The motion is carried unanimously.",
      ].join("\n\n"),
      draft: completedMeetingDraft(),
      tags: ["ux-archive", "finance", "heritage"],
    });
    const completedArchive = await completeMeeting(completedMeeting.meetingId);

    const meetings = await selectRows<{
      id: string;
      title: string;
      status: string;
      category: string;
      manual_tags: string[];
      last_error_code: string | null;
      signed_pdf_id: string | null;
    }>(
      "meetings",
      "id,title,status,category,manual_tags,last_error_code,signed_pdf_id",
      "meeting_date.asc",
    );

    expect(meetings).toHaveLength(3);
    expect(meetings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: reviewMeeting.meetingId,
        title: "July Community Projects Meeting",
        status: "PENDING_APPROVAL",
        manual_tags: expect.arrayContaining(["ux-review"]),
      }),
      expect.objectContaining({
        id: failedMeeting.meetingId,
        title: "Emergency Drainage Review",
        status: "AI_FAILED",
        last_error_code: "invalid_analysis_output",
      }),
      expect.objectContaining({
        id: completedMeeting.meetingId,
        title: "2026 Annual Budget Meeting",
        status: "COMPLETED",
        signed_pdf_id: completedArchive.signedPdfId,
      }),
    ]));

    const reviewDetail = await requiredReview(reviewMeeting.meetingId);
    expect(reviewDetail).toMatchObject({
      status: "PENDING_APPROVAL",
      minutes: reviewMeetingDraft().minutes,
    });
    expect(reviewDetail.attendees).toHaveLength(5);
    expect(reviewDetail.motions).toHaveLength(2);
    expect(reviewDetail.motions).toContainEqual(expect.objectContaining({
      outcome: "not_seconded",
      seconderProfileId: null,
    }));
    expect(reviewDetail.motions.flatMap((motion) => motion.votes))
      .toContainEqual(expect.objectContaining({ selection: "unresolved" }));

    const failedDetail = await requiredReview(failedMeeting.meetingId);
    expect(failedDetail).toMatchObject({
      status: "AI_FAILED",
      minutes: null,
      humanOwned: false,
      failure: {
        code: "invalid_analysis_output",
        message: "The transcript analysis returned malformed output on the final attempt.",
      },
    });

    const signedPdfs = await selectRows<{
      id: string;
      pdf_type: string;
      storage_path: string;
      page_count: number;
    }>(
      "meeting_pdfs",
      "id,pdf_type,storage_path,page_count",
      "created_at.asc",
      `meeting_id=eq.${completedMeeting.meetingId}`,
    );
    expect(signedPdfs).toContainEqual(expect.objectContaining({
      id: completedArchive.signedPdfId,
      pdf_type: "SIGNED",
      storage_path: expect.stringContaining(`signed/${completedMeeting.meetingId}/`),
      page_count: expect.any(Number),
    }));

    process.stdout.write(`\nUX fixtures created:\n${JSON.stringify({
      review: {
        meetingId: reviewMeeting.meetingId,
        status: "PENDING_APPROVAL",
        path: `/app/meetings/${reviewMeeting.meetingId}`,
      },
      recovery: {
        meetingId: failedMeeting.meetingId,
        status: "AI_FAILED",
        path: `/app/meetings/${failedMeeting.meetingId}`,
      },
      archive: {
        meetingId: completedMeeting.meetingId,
        status: "COMPLETED",
        signedPdfId: completedArchive.signedPdfId,
        path: `/app/archive/${completedMeeting.meetingId}`,
      },
    }, null, 2)}\n`);
  }, 60_000);
});

async function createAnalyzedMeeting({
  key,
  title,
  startedAt,
  endedAt,
  attendees,
  transcript,
  draft,
  tags,
}: MeetingFixtureInput & { draft: MeetingDraft; tags: string[] }) {
  const stored = await storeMeeting({
    key,
    title,
    startedAt,
    endedAt,
    attendees,
    transcript,
  });
  const repository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey });
  const claim = await repository.claimAnalysis(stored.meetingId);
  if (claim.status !== "claimed") {
    throw new Error(`Analysis claim for ${title} returned ${claim.status}.`);
  }
  const persistence = await repository.persistDraft(
    stored.meetingId,
    claim.runId,
    MeetingDraftSchema.parse(draft),
  );
  if (persistence !== "saved") {
    throw new Error(`Analysis draft for ${title} returned ${persistence}.`);
  }
  const review = await requiredReview(stored.meetingId);
  const tagged = await createMeetingReviewService(
    createSupabaseMeetingReviewRepository({ apiUrl, secretKey }),
  ).saveMeetingDraft({
    meetingId: stored.meetingId,
    expectedVersion: review.version,
    actorProfileId: profiles.eleanor.id,
    draft: toReviewDraft(draft, tags),
  });
  if (tagged.status !== "saved") {
    throw new Error(`Review fixture tagging for ${title} returned ${tagged.status}.`);
  }
  return stored;
}

async function createFailedMeeting(input: MeetingFixtureInput) {
  const stored = await storeMeeting(input);
  const repository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey });
  const failures = [
    {
      code: "provider_failure",
      message: "The analysis provider was temporarily unavailable.",
      expected: "retry_scheduled",
    },
    {
      code: "openai_timeout",
      message: "The transcript analysis exceeded its response deadline.",
      expected: "retry_scheduled",
    },
    {
      code: "invalid_analysis_output",
      message: "The transcript analysis returned malformed output on the final attempt.",
      expected: "failed",
    },
  ] as const;

  for (const failure of failures) {
    const claim = await repository.claimAnalysis(stored.meetingId);
    if (claim.status !== "claimed") {
      throw new Error(`Failure fixture analysis claim returned ${claim.status}.`);
    }
    const result = await repository.recordFailure(stored.meetingId, claim.runId, failure);
    if (result !== failure.expected) {
      throw new Error(`Failure fixture persistence returned ${result}.`);
    }
  }
  return stored;
}

async function storeMeeting(input: MeetingFixtureInput) {
  const packet = fixturePacket(input);
  const store = createTranscriptImportStore(
    createSupabaseTranscriptRepository({ apiUrl, secretKey }),
  );
  const stored = await store(packet);
  if (stored.status !== "stored") {
    throw new Error(`Transcript fixture ${input.key} already exists.`);
  }
  return stored;
}

async function completeMeeting(meetingId: string) {
  const review = await requiredReview(meetingId);
  const approvalRepository = createSupabaseMeetingApprovalRepository({ apiUrl, secretKey });
  const storage = createSupabaseMinutesPdfStorage({ apiUrl, secretKey });
  const provider = new FakeSigningProvider();
  const signingRecipient = {
    firstName: "Priya",
    lastName: "Shah",
    email: profiles.priya.email,
  };
  const signing = createMeetingSigningProcessor({
    repository: createSupabaseMeetingSigningRepository({ apiUrl, secretKey }),
    pdfSource: storage,
    provider,
    recipient: signingRecipient,
  });
  const approval = createMeetingApprovalService({
    repository: approvalRepository,
    processPdf: createMeetingPdfProcessor({
      repository: approvalRepository,
      storage,
    }),
    processSigning: signing,
  });

  const approved = await approval.approveMeeting({
    meetingId,
    expectedVersion: review.version,
    actorProfileId: profiles.eleanor.id,
    acknowledgeUnresolvedVotes: false,
  });
  if (approved.status !== "approved") {
    throw new Error(`Archive fixture approval returned ${approved.status}.`);
  }

  const routedPdf = provider.created[0]?.document;
  if (!routedPdf) throw new Error("Archive fixture did not route an unsigned PDF.");
  provider.signedDocument = new Uint8Array(routedPdf);
  provider.requestStatus = "finished";
  provider.completedAt = "2026-07-01T09:15:00.000Z";

  const outcome = createSigningOutcomeProcessor({
    repository: createSupabaseMeetingSigningOutcomeRepository({ apiUrl, secretKey }),
    provider,
    signerEmail: signingRecipient.email,
  });
  const signingResult = await outcome.reconcileMeeting(meetingId);
  if (signingResult.status !== "ready_for_archive") {
    throw new Error(`Archive fixture signing outcome returned ${signingResult.status}.`);
  }

  const archive = createMeetingArchiveProcessor({
    repository: createSupabaseMeetingArchiveRepository({ apiUrl, secretKey }),
    storage,
    provider,
    retryCount: 0,
  });
  const archiveResult = await archive(meetingId);
  if (archiveResult.status !== "completed" || !archiveResult.signedPdfId) {
    throw new Error(`Archive fixture completion returned ${archiveResult.status}.`);
  }
  return { signedPdfId: archiveResult.signedPdfId };
}

function fixturePacket({
  key,
  title,
  startedAt,
  endedAt,
  attendees,
  transcript,
}: MeetingFixtureInput): TranscriptWebhookPacket {
  const durationMinutes = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000);
  return TranscriptWebhookPacketSchema.parse({
    eventId: `${key}-event`,
    eventType: "transcript.ready",
    occurredAt: endedAt,
    sentAt: new Date(Date.parse(endedAt) + 60_000).toISOString(),
    meeting: {
      sourceMeetingId: `${key}-meeting`,
      title,
      startedAt,
      endedAt,
      durationMinutes,
    },
    attendees: attendees.map((attendee) => ({
      displayName: attendee.name,
      email: attendee.email,
    })),
    transcript: {
      sourceTranscriptId: `${key}-transcript`,
      contentType: "text/plain",
      language: "en-GB",
      content: transcript,
      metadata: {
        language: "en-GB",
        startTime: startedAt,
        endTime: endedAt,
        participants: attendees,
      },
    },
  });
}

function reviewMeetingDraft(): MeetingDraft {
  return MeetingDraftSchema.parse({
    schemaVersion: "1.0",
    minutes: {
      summary: "The board reviewed community projects, capital works, and the next quarter's delivery priorities.",
      sections: [
        {
          heading: "Previous actions",
          content: "The board confirmed that the prior action register was substantially complete.",
        },
        {
          heading: "Courtyard community garden",
          content: "Members reviewed the garden proposal, accessibility requirements, and the proposed reserve allocation.",
        },
        {
          heading: "Capital works",
          content: "The roof inspection and drainage maintenance schedules were reviewed.",
        },
        {
          heading: "Next meeting",
          content: "Updated contractor quotations will be presented at the August meeting.",
        },
      ],
    },
    attendees: Object.values(profiles).map((profile) => ({
      participantRef: profile.id,
      displayName: profile.name,
    })),
    motions: [
      {
        text: "Approve the courtyard community garden project and allocate up to £7,500 from unrestricted reserves.",
        mover: { status: "resolved", participantRef: profiles.daniel.id },
        seconder: { status: "resolved", participantRef: profiles.marcus.id },
        outcome: "carried",
        votes: [
          { participantRef: profiles.eleanor.id, value: "for" },
          { participantRef: profiles.marcus.id, value: "for" },
          { participantRef: profiles.priya.id, value: "abstain" },
          { participantRef: profiles.daniel.id, value: "for" },
          { participantRef: profiles.amelia.id, value: "unresolved" },
        ],
      },
      {
        text: "Commission a second feasibility study for the eastern boundary wall.",
        mover: { status: "resolved", participantRef: profiles.amelia.id },
        seconder: { status: "unresolved", participantRef: null },
        outcome: "not_seconded",
        votes: [],
      },
    ],
  });
}

function completedMeetingDraft(): MeetingDraft {
  return MeetingDraftSchema.parse({
    schemaVersion: "1.0",
    minutes: {
      summary: "The members adopted the 2026 annual budget and confirmed the heritage roof renewal allocation.",
      sections: [
        {
          heading: "Budget review",
          content: "Income, operating expenditure, reserves, and planned capital works were reviewed.",
        },
        {
          heading: "Heritage roof renewal",
          content: "The budget retains the approved allocation for the heritage roof renewal programme.",
        },
        {
          heading: "Resolution",
          content: "The 2026 annual budget was adopted unanimously.",
        },
      ],
    },
    attendees: [profiles.eleanor, profiles.marcus, profiles.priya].map((profile) => ({
      participantRef: profile.id,
      displayName: profile.name,
    })),
    motions: [{
      text: "Adopt the 2026 annual budget, including the heritage roof renewal allocation.",
      mover: { status: "resolved", participantRef: profiles.marcus.id },
      seconder: { status: "resolved", participantRef: profiles.priya.id },
      outcome: "carried",
      votes: [
        { participantRef: profiles.eleanor.id, value: "for" },
        { participantRef: profiles.marcus.id, value: "for" },
        { participantRef: profiles.priya.id, value: "for" },
      ],
    }],
  });
}

function toReviewDraft(draft: MeetingDraft, tags: string[]): MeetingReviewDraft {
  return {
    minutes: draft.minutes,
    attendeeProfileIds: draft.attendees.map((attendee) => attendee.participantRef),
    motions: draft.motions.map((motion) => ({
      text: motion.text,
      moverProfileId: motion.mover.status === "resolved"
        ? motion.mover.participantRef
        : null,
      seconderProfileId: motion.seconder.status === "resolved"
        ? motion.seconder.participantRef
        : null,
      outcome: motion.outcome,
      votes: motion.votes.map((vote) => ({
        profileId: vote.participantRef,
        selection: vote.value,
      })),
    })),
    tags,
  };
}

async function requiredReview(meetingId: string) {
  const service = createMeetingReviewService(
    createSupabaseMeetingReviewRepository({ apiUrl, secretKey }),
  );
  const detail = await service.getMeetingReview(meetingId);
  if (!detail) throw new Error(`Meeting ${meetingId} was not found.`);
  return detail;
}

async function selectRows<T>(
  table: string,
  select: string,
  order?: string,
  filter?: string,
): Promise<T[]> {
  const url = new URL(`/rest/v1/${table}`, apiUrl);
  url.searchParams.set("select", select);
  if (order) url.searchParams.set("order", order);
  if (filter) {
    const [key, value] = filter.split("=", 2);
    if (key && value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, { headers: serviceHeaders() });
  if (!response.ok) {
    throw new Error(`Local Supabase ${table} query failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T[]>;
}

function serviceHeaders() {
  return {
    apikey: secretKey,
    authorization: `Bearer ${secretKey}`,
  };
}

function isLoopbackUrl(value: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

interface MeetingFixtureInput {
  key: string;
  title: string;
  startedAt: string;
  endedAt: string;
  attendees: Array<{ name: string; email: string }>;
  transcript: string;
}
