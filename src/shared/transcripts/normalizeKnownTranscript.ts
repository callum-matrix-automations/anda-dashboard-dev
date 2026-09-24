import type {
  TranscriptAliasCandidate,
  TranscriptFormat,
  TranscriptNormalizationSummary,
  TranscriptNormalizationTurn,
  TranscriptNormalizationWarning,
  TranscriptParticipant,
} from "../contracts/transcriptNormalization";

const SPEAKER_NAME = String.raw`[\p{L}][\p{L}\p{M}\d .,'’()\-]{0,199}`;
const SPEAKER_LINE = new RegExp(`^(${SPEAKER_NAME}):[ \\t]+(.+)$`, "u");
const TIMESTAMP = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?`;
const TIMESTAMP_RANGE = new RegExp(`^${TIMESTAMP}[ \\t]*-->[ \\t]*${TIMESTAMP}(?:[ \\t].*)?$`, "u");
const TIMESTAMP_SPEAKER = new RegExp(`^(?:\\[)?${TIMESTAMP}(?:\\])?[ \\t]*(?:[-–—|][ \\t]*)(${SPEAKER_NAME})$`, "u");
const TIMESTAMPED_SPEAKER_LINE = new RegExp(`^(?:\\[)?${TIMESTAMP}(?:\\])?[ \\t]+(?:[-–—|][ \\t]*)?(${SPEAKER_NAME}):[ \\t]+(.+)$`, "u");

export interface KnownTranscriptNormalization {
  detectedFormat: TranscriptFormat;
  turns: TranscriptNormalizationTurn[];
  canonicalTranscript: string;
  summary: TranscriptNormalizationSummary | null;
}

export function normalizeKnownTranscript(content: string): KnownTranscriptNormalization {
  const normalizedLines = content.replace(/\r\n?/gu, "\n").split("\n");
  const format = detectTranscriptFormat(normalizedLines);
  const turns = format === "timestamp_speaker_blocks"
    ? parseTimestampSpeakerBlocks(normalizedLines)
    : format === "timestamped_speaker_lines"
      ? parseTimestampedSpeakerLines(normalizedLines)
      : format === "srt" || format === "webvtt"
        ? parseCaptionTranscript(normalizedLines)
        : format === "speaker_colon"
          ? parseSpeakerColonTranscript(normalizedLines)
          : [];

  if (turns.length === 0) {
    return { detectedFormat: "unknown", turns: [], canonicalTranscript: "", summary: null };
  }

  const canonicalTranscript = turns
    .map((turn) => `${turn.speaker}: ${turn.dialogue}`)
    .join("\n");
  return {
    detectedFormat: format,
    turns,
    canonicalTranscript,
    summary: summarizeTranscriptNormalization({
      method: "deterministic",
      detectedFormat: format,
      turns,
      sourceContent: content,
    }),
  };
}

export function detectTranscriptFormat(linesOrContent: string[] | string): TranscriptFormat {
  const lines = typeof linesOrContent === "string"
    ? linesOrContent.replace(/\r\n?/gu, "\n").split("\n")
    : linesOrContent;
  const nonBlank = lines.map((line) => line.trim()).filter(Boolean);
  if (nonBlank[0]?.toUpperCase() === "WEBVTT") return "webvtt";
  if (nonBlank.some((line) => TIMESTAMP_RANGE.test(line))) return "srt";
  if (nonBlank.some((line) => TIMESTAMPED_SPEAKER_LINE.test(line))) return "timestamped_speaker_lines";
  if (nonBlank.some((line) => TIMESTAMP_SPEAKER.test(line))) return "timestamp_speaker_blocks";
  if (nonBlank.some((line) => SPEAKER_LINE.test(line))) return "speaker_colon";
  return "unknown";
}

export function summarizeTranscriptNormalization({
  method,
  detectedFormat,
  turns,
  sourceContent,
}: {
  method: "deterministic" | "gpt-6-luna";
  detectedFormat: TranscriptFormat;
  turns: TranscriptNormalizationTurn[];
  sourceContent: string;
}): TranscriptNormalizationSummary {
  const participants = collectParticipants(turns);
  const possibleAliases = findPossibleAliases(participants.map((participant) => participant.displayName));
  const attributionCoverage = calculateAttributionCoverage(turns, sourceContent);
  const warnings: TranscriptNormalizationWarning[] = [];
  const genericCount = participants.filter((participant) => participant.kind === "generic").length;
  if (genericCount > 0) {
    warnings.push({
      code: "generic_speakers",
      severity: "warning",
      message: `${genericCount} generic or unidentified speaker label${genericCount === 1 ? " was" : "s were"} retained and will not be matched to a member automatically.`,
    });
  }
  if (possibleAliases.length > 0) {
    warnings.push({
      code: "possible_aliases",
      severity: "warning",
      message: "Some speaker labels may refer to the same person. They were kept separate for review.",
    });
  }
  if (attributionCoverage < 0.85) {
    warnings.push({
      code: "low_attribution_coverage",
      severity: "warning",
      message: `Only ${Math.round(attributionCoverage * 100)}% of the transcript text was confidently attributed to a speaker. Review attendance and motions carefully.`,
    });
  }
  if (detectedFormat === "unknown") {
    warnings.push({
      code: "unrecognized_format",
      severity: "info",
      message: "The transcript format was not recognised directly, so GPT-6 Luna was used to identify speaker turns.",
    });
  }

  return {
    method,
    detectedFormat,
    participants,
    possibleAliases,
    warnings,
    turnCount: turns.length,
    attributionCoverage,
  };
}

export function isGenericSpeaker(displayName: string) {
  return /^(?:unidentified|unknown)(?: speaker)?$|^speaker(?: [a-z0-9]+)?$|^participant(?: [a-z0-9]+)?$|^attendee(?: [a-z0-9]+)?$|^guest(?: [a-z0-9]+)?$/iu
    .test(normalizeDisplayName(displayName));
}

export function findPossibleAliases(displayNames: string[]): TranscriptAliasCandidate[] {
  const aliases: TranscriptAliasCandidate[] = [];
  for (let firstIndex = 0; firstIndex < displayNames.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < displayNames.length; secondIndex += 1) {
      const first = displayNames[firstIndex];
      const second = displayNames[secondIndex];
      if (!first || !second || isGenericSpeaker(first) || isGenericSpeaker(second)) continue;
      const firstParts = aliasParts(first);
      const secondParts = aliasParts(second);
      const oneIsSingleName = firstParts.length === 1 || secondParts.length === 1;
      if (oneIsSingleName && firstParts[0] === secondParts[0]) aliases.push({ first, second });
    }
  }
  return aliases;
}

function parseSpeakerColonTranscript(lines: string[]) {
  const turns: TranscriptNormalizationTurn[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const match = rawLine === rawLine.trimStart() ? SPEAKER_LINE.exec(line) : null;
    if (match?.[1] && match[2]) {
      turns.push({ speaker: normalizeDisplayName(match[1]), dialogue: normalizeDialogue(match[2]) });
    } else if (line.trim() && turns.length > 0) {
      const current = turns[turns.length - 1];
      if (current) current.dialogue = normalizeDialogue(`${current.dialogue} ${line.trim()}`);
    }
  }
  return turns;
}

function parseTimestampSpeakerBlocks(lines: string[]) {
  const turns: TranscriptNormalizationTurn[] = [];
  let current: TranscriptNormalizationTurn | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const header = TIMESTAMP_SPEAKER.exec(line);
    if (header?.[1]) {
      if (current?.dialogue) turns.push(current);
      current = { speaker: normalizeDisplayName(header[1]), dialogue: "" };
      continue;
    }
    if (line && current) current.dialogue = normalizeDialogue(`${current.dialogue} ${line}`);
  }
  if (current?.dialogue) turns.push(current);
  return turns;
}

function parseTimestampedSpeakerLines(lines: string[]) {
  return lines.flatMap((rawLine) => {
    const match = TIMESTAMPED_SPEAKER_LINE.exec(rawLine.trim());
    return match?.[1] && match[2]
      ? [{ speaker: normalizeDisplayName(match[1]), dialogue: normalizeDialogue(match[2]) }]
      : [];
  });
}

function parseCaptionTranscript(lines: string[]) {
  const contentLines = lines.filter((rawLine) => {
    const line = rawLine.trim();
    return line
      && line.toUpperCase() !== "WEBVTT"
      && !/^\d+$/u.test(line)
      && !TIMESTAMP_RANGE.test(line);
  });
  return parseSpeakerColonTranscript(contentLines);
}

function collectParticipants(turns: TranscriptNormalizationTurn[]): TranscriptParticipant[] {
  const participants = new Map<string, TranscriptParticipant>();
  for (const turn of turns) {
    const displayName = normalizeDisplayName(turn.speaker);
    const key = displayName.toLocaleLowerCase("en-GB");
    if (!participants.has(key)) {
      participants.set(key, {
        displayName,
        kind: isGenericSpeaker(displayName) ? "generic" : "named",
      });
    }
  }
  return [...participants.values()];
}

function calculateAttributionCoverage(turns: TranscriptNormalizationTurn[], sourceContent: string) {
  const attributedCharacters = turns.reduce((total, turn) => total + compact(turn.dialogue).length, 0);
  const meaningfulSourceCharacters = sourceContent
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed
        && trimmed.toUpperCase() !== "WEBVTT"
        && !/^\d+$/u.test(trimmed)
        && !TIMESTAMP_RANGE.test(trimmed)
        && !TIMESTAMP_SPEAKER.test(trimmed);
    })
    .reduce((total, line) => total + compact(line.replace(SPEAKER_LINE, "$2")).length, 0);
  if (meaningfulSourceCharacters === 0) return 1;
  return Math.min(1, Number((attributedCharacters / meaningfulSourceCharacters).toFixed(4)));
}

function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeDialogue(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function aliasParts(value: string) {
  return normalizeDisplayName(value)
    .toLocaleLowerCase("en-GB")
    .replace(/[^\p{L}\p{M}\d ]/gu, "")
    .split(/\s+/u)
    .filter(Boolean);
}

function compact(value: string) {
  return value.replace(/\s+/gu, "");
}
