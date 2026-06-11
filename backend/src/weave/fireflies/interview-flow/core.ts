import { AGGREGATION_PROMPT_TEMPLATE, EXTRACTION_PROMPT_TEMPLATE } from "./prompts.js";
import { ManifestEntry, TranscriptInput } from "./types.js";

type JsonRecord = Record<string, unknown>;

export interface AggregateOutputShape extends JsonRecord {
  readonly mermaid_flowchart: string;
  readonly summary: unknown;
}

export function buildManifestEntries(
  bucket: string,
  keys: readonly string[],
  limit: number,
): ManifestEntry[] {
  return keys
    .filter((key) => key === "transcript.json" || key.endsWith("/transcript.json"))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit)
    .map((key, index) => ({
      transcriptId: `interview_${String(index + 1).padStart(3, "0")}`,
      candidateName: null,
      s3Bucket: bucket,
      transcriptKey: key,
    }));
}

export function firefliesTranscriptToText(value: unknown): string {
  const record = asRecord(value);
  const sentences = Array.isArray(record.sentences) ? record.sentences : [];
  const lines = sentences
    .map((sentence) => sentenceToLine(asRecord(sentence)))
    .filter((line): line is string => Boolean(line));

  if (lines.length > 0) {
    return lines.join("\n");
  }

  const fallbackText = stringValue(record.transcript_text) ?? stringValue(record.text);
  return fallbackText ?? "";
}

export function buildExtractionPrompt(input: TranscriptInput): string {
  const wrapper = JSON.stringify(
    {
      transcript_id: input.transcriptId,
      candidate_name: input.candidateName,
      transcript_text: input.transcriptText,
    },
    null,
    2,
  );
  return EXTRACTION_PROMPT_TEMPLATE.replace("{{TRANSCRIPT_TEXT}}", wrapper);
}

export function buildAggregationPrompt(extractions: readonly unknown[]): string {
  return AGGREGATION_PROMPT_TEMPLATE.replace(
    "{{ALL_TRANSCRIPT_EXTRACTIONS_JSON}}",
    JSON.stringify(extractions, null, 2),
  );
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] ?? "" : sliceJsonObject(trimmed);
  return JSON.parse(candidate);
}

export function isExtractionOutput(value: unknown): value is JsonRecord {
  const record = asRecord(value);
  return Boolean(
    record.interview_metadata &&
      Array.isArray(record.question_events) &&
      record.observed_patterns &&
      Array.isArray(record.flowchart_edges) &&
      record.quality_notes,
  );
}

export function isAggregateOutput(value: unknown): value is AggregateOutputShape {
  const record = asRecord(value);
  return Boolean(
    record.global_interview_flow &&
      Array.isArray(record.canonical_questions) &&
      Array.isArray(record.follow_up_logic) &&
      record.flowchart &&
      typeof record.mermaid_flowchart === "string" &&
      record.summary,
  );
}

export function buildJsonRepairPrompt(invalidResponse: string, target: "extraction" | "aggregate"): string {
  return [
    "Return valid JSON only.",
    `Repair this ${target} response so it matches the requested schema.`,
    "Do not add evidence or behavior that is not present in the original response.",
    "<INVALID_RESPONSE>",
    invalidResponse,
    "</INVALID_RESPONSE>",
  ].join("\n");
}

function sentenceToLine(sentence: JsonRecord): string | null {
  const text = stringValue(sentence.text);
  if (!text) {
    return null;
  }
  const speaker = normalizeSpeaker(
    stringValue(sentence.speaker_name) ??
      stringValue(sentence.speakerName) ??
      stringValue(sentence.speaker),
  );
  const timestamp = secondsToTimestamp(
    numberValue(sentence.start_time) ??
      numberValue(sentence.startTime) ??
      numberValue(sentence.start),
  );
  return `[${timestamp}] ${speaker}: ${text}`;
}

function normalizeSpeaker(value: string | null): "INTERVIEWER" | "CANDIDATE" {
  if (value && /prakul|interviewer|host/i.test(value)) {
    return "INTERVIEWER";
  }
  return "CANDIDATE";
}

function secondsToTimestamp(value: number | null): string {
  const totalSeconds = Math.max(0, Math.floor(value ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function sliceJsonObject(text: string): string {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) {
    return text;
  }
  return text.slice(first, last + 1);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
