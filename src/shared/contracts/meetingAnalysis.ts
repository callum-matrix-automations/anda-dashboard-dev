import { z } from "zod";

export const MEETING_ANALYSIS_SCHEMA_VERSION = "1.0" as const;

const ResolvedParticipantSchema = z.object({
  status: z.literal("resolved"),
  participantRef: z.string().trim().min(1),
}).strict();

const UnresolvedParticipantSchema = z.object({
  status: z.literal("unresolved"),
  participantRef: z.null(),
}).strict();

export const ParticipantResolutionSchema = z.discriminatedUnion("status", [
  ResolvedParticipantSchema,
  UnresolvedParticipantSchema,
]);

export const MeetingAnalysisInputSchema = z.object({
  meeting: z.object({
    sourceMeetingId: z.string().trim().min(1).max(500),
    title: z.string().trim().min(1).max(500),
    meetingDate: z.string().trim().min(1).max(100),
    durationMinutes: z.number().int().positive().max(1_440),
  }).strict(),
  transcript: z.object({
    language: z.string().trim().min(1).max(50),
    content: z.string().max(1_000_000).refine((content) => content.trim().length > 0, {
      message: "Transcript content must not be blank.",
    }),
  }).strict(),
  participants: z.array(z.object({
    participantRef: z.string().trim().min(1).max(500),
    displayName: z.string().trim().min(1).max(500),
  }).strict()).max(250),
}).strict().superRefine((input, context) => {
  const seenReferences = new Set<string>();
  for (const [index, participant] of input.participants.entries()) {
    if (seenReferences.has(participant.participantRef)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Participant references must be unique.",
        path: ["participants", index, "participantRef"],
      });
    }
    seenReferences.add(participant.participantRef);
  }
});

const MeetingDraftAttendeeSchema = z.object({
  participantRef: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
}).strict();

const MeetingDraftVoteSchema = z.object({
  participantRef: z.string().trim().min(1),
  value: z.enum(["for", "against", "abstain", "unresolved"]),
}).strict();

const MeetingDraftMotionSchema = z.object({
  text: z.string().trim().min(1),
  mover: ParticipantResolutionSchema,
  seconder: ParticipantResolutionSchema,
  outcome: z.enum(["carried", "failed", "tabled", "not_seconded", "unresolved"]),
  votes: z.array(MeetingDraftVoteSchema),
}).strict();

export const MeetingDraftSchema = z.object({
  schemaVersion: z.literal(MEETING_ANALYSIS_SCHEMA_VERSION),
  minutes: z.object({
    summary: z.string().trim().min(1),
    sections: z.array(z.object({
      heading: z.string().trim().min(1),
      content: z.string().trim().min(1),
    }).strict()).min(1),
  }).strict(),
  attendees: z.array(MeetingDraftAttendeeSchema),
  motions: z.array(MeetingDraftMotionSchema),
}).strict().superRefine((draft, context) => {
  const attendeeReferences = new Set<string>();
  for (const [index, attendee] of draft.attendees.entries()) {
    if (attendeeReferences.has(attendee.participantRef)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Draft attendee references must be unique.",
        path: ["attendees", index, "participantRef"],
      });
    }
    attendeeReferences.add(attendee.participantRef);
  }

  for (const [motionIndex, motion] of draft.motions.entries()) {
    for (const role of ["mover", "seconder"] as const) {
      const resolution = motion[role];
      if (resolution.status === "resolved" && !attendeeReferences.has(resolution.participantRef)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Resolved ${role} must reference a draft attendee.`,
          path: ["motions", motionIndex, role, "participantRef"],
        });
      }
    }
    if (motion.outcome === "not_seconded" && motion.seconder.status !== "unresolved") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A motion marked not seconded cannot name a seconder.",
        path: ["motions", motionIndex, "seconder"],
      });
    }

    const voteReferences = new Set<string>();
    for (const [voteIndex, vote] of motion.votes.entries()) {
      if (!attendeeReferences.has(vote.participantRef)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Votes must reference a draft attendee.",
          path: ["motions", motionIndex, "votes", voteIndex, "participantRef"],
        });
      }
      if (voteReferences.has(vote.participantRef)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A participant may appear only once in a motion's votes.",
          path: ["motions", motionIndex, "votes", voteIndex, "participantRef"],
        });
      }
      voteReferences.add(vote.participantRef);
    }
  }
});

export type MeetingAnalysisInput = z.infer<typeof MeetingAnalysisInputSchema>;
export type MeetingDraft = z.infer<typeof MeetingDraftSchema>;

// Kept beside the runtime Zod contract so the OpenAI constraint and application
// validation describe the same public payload.
export const MEETING_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "minutes", "attendees", "motions"],
  properties: {
    schemaVersion: {
      type: "string",
      enum: [MEETING_ANALYSIS_SCHEMA_VERSION],
      description: "Version of the meeting analysis contract.",
    },
    minutes: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "sections"],
      properties: {
        summary: {
          type: "string",
          description: "A concise factual summary of the meeting.",
        },
        sections: {
          type: "array",
          description: "Ordered sections of draft minutes grouped by agenda topic.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["heading", "content"],
            properties: {
              heading: { type: "string", description: "Short section heading." },
              content: { type: "string", description: "Factual prose for this section." },
            },
          },
        },
      },
    },
    attendees: {
      type: "array",
      description: "Attendees selected only from the supplied participant references.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["participantRef", "displayName"],
        properties: {
          participantRef: { type: "string", description: "Exact supplied participant reference." },
          displayName: { type: "string", description: "Exact supplied participant display name." },
        },
      },
    },
    motions: {
      type: "array",
      description: "Formal motions supported by transcript evidence.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "mover", "seconder", "outcome", "votes"],
        properties: {
          text: { type: "string", description: "The motion as stated or faithfully paraphrased." },
          mover: { $ref: "#/$defs/participantResolution" },
          seconder: { $ref: "#/$defs/participantResolution" },
          outcome: {
            type: "string",
            enum: ["carried", "failed", "tabled", "not_seconded", "unresolved"],
          },
          votes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["participantRef", "value"],
              properties: {
                participantRef: { type: "string", description: "Exact supplied participant reference." },
                value: {
                  type: "string",
                  enum: ["for", "against", "abstain", "unresolved"],
                },
              },
            },
          },
        },
      },
    },
  },
  $defs: {
    participantResolution: {
      type: "object",
      additionalProperties: false,
      required: ["status", "participantRef"],
      properties: {
        status: { type: "string", enum: ["resolved", "unresolved"] },
        participantRef: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Exact supplied reference when resolved; null when unresolved.",
        },
      },
    },
  },
};
