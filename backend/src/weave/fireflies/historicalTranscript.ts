type JsonRecord = Record<string, unknown>;

export interface HistoricalTranscriptTurn {
  readonly turnIndex: number;
  readonly speaker: "agent" | "candidate";
  readonly questionId: string | null;
  readonly text: string;
  readonly offsetMs: number | null;
}

export function historicalTranscriptTurns(value: unknown): HistoricalTranscriptTurn[] {
  const record = asRecord(value);
  const sentences = Array.isArray(record.sentences) ? record.sentences : [];
  const turns: HistoricalTranscriptTurn[] = [];

  for (const sentence of sentences) {
    const row = asRecord(sentence);
    const text = stringValue(row.text);
    if (!text) continue;
    turns.push({
      turnIndex: turns.length,
      speaker: historicalSpeaker(row),
      questionId: null,
      text,
      offsetMs: offsetMs(row),
    });
  }

  return turns;
}

function historicalSpeaker(sentence: JsonRecord): "agent" | "candidate" {
  const raw =
    stringValue(sentence.speaker_name) ??
    stringValue(sentence.speakerName) ??
    stringValue(sentence.speaker) ??
    "";
  return /prakul|interviewer|host/i.test(raw) ? "agent" : "candidate";
}

function offsetMs(sentence: JsonRecord): number | null {
  const seconds =
    numberValue(sentence.start_time) ??
    numberValue(sentence.startTime) ??
    numberValue(sentence.start);
  return seconds === null ? null : Math.max(0, Math.round(seconds * 1000));
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
