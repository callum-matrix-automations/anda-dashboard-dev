import { describe, expect, it, vi } from "vitest";
import { createTranscriptNormalizer } from "../../src/backend/services/transcripts/normalizeTranscript";
import { normalizeKnownTranscript } from "../../src/shared/transcripts/normalizeKnownTranscript";

describe("transcript normalization", () => {
  it("normalizes the reported timestamp-speaker format without an AI call", async () => {
    const createStructuredResponse = vi.fn();
    const normalize = createTranscriptNormalizer({ createStructuredResponse });
    const result = await normalize([
      "0:00 - Ernesto Tinoco",
      "Looks like Read AI finally joined us.",
      "0:04 - Richard Ripper",
      "We can begin.",
      "10:42 - Unidentified Speaker",
      "So moved. Second. All in favor? Aye.",
      "10:58 - Richard",
      "The motion is carried.",
    ].join("\n"));

    expect(createStructuredResponse).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      method: "deterministic",
      detectedFormat: "timestamp_speaker_blocks",
      participants: [
        { displayName: "Ernesto Tinoco", kind: "named" },
        { displayName: "Richard Ripper", kind: "named" },
        { displayName: "Unidentified Speaker", kind: "generic" },
        { displayName: "Richard", kind: "named" },
      ],
      possibleAliases: [{ first: "Richard Ripper", second: "Richard" }],
      turnCount: 4,
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "generic_speakers",
      "possible_aliases",
    ]);
    expect(result.canonicalTranscript).toContain("Ernesto Tinoco: Looks like Read AI finally joined us.");
  });

  it("supports speaker-labelled, timestamped-line, SRT, and WebVTT inputs", () => {
    expect(normalizeKnownTranscript("Chair: Welcome.\nMember: Thank you.").detectedFormat).toBe("speaker_colon");
    expect(normalizeKnownTranscript("[00:01] Chair: Welcome.").detectedFormat).toBe("timestamped_speaker_lines");
    expect(normalizeKnownTranscript("1\n00:00:01,000 --> 00:00:03,000\nChair: Welcome.").detectedFormat).toBe("srt");
    expect(normalizeKnownTranscript("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nChair: Welcome.").detectedFormat).toBe("webvtt");
  });

  it("uses Luna only for unknown formats and validates copied evidence", async () => {
    const createStructuredResponse = vi.fn().mockResolvedValue({
      responseId: "resp_normalize_1",
      requestId: "req_normalize_1",
      model: "gpt-6-luna",
      status: "completed",
      outputText: JSON.stringify({
        turns: [
          { speaker: "Chair", dialogue: "Welcome to the meeting." },
          { speaker: "Member", dialogue: "I second the motion." },
        ],
      }),
    });
    const normalize = createTranscriptNormalizer({ createStructuredResponse });
    const result = await normalize([
      "Chair\nWelcome to the meeting.",
      "Member\nI second the motion.",
    ].join("\n"));

    expect(createStructuredResponse).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      method: "gpt-6-luna",
      detectedFormat: "unknown",
      model: "gpt-6-luna",
      responseId: "resp_normalize_1",
    });
    expect(result.warnings.some((warning) => warning.code === "unrecognized_format")).toBe(true);
  });

  it("rejects Luna output that invents or rewrites dialogue", async () => {
    const normalize = createTranscriptNormalizer({
      createStructuredResponse: vi.fn().mockResolvedValue({
        responseId: "resp_normalize_2",
        model: "gpt-6-luna",
        status: "completed",
        outputText: JSON.stringify({
          turns: [{ speaker: "Chair", dialogue: "Invented dialogue." }],
        }),
      }),
    });

    await expect(normalize("Chair\nWelcome to the meeting.")).rejects.toMatchObject({
      code: "normalization_changed_evidence",
    });
  });
});
