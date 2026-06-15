export interface HistoricalFirefliesRecording {
  readonly transcriptId: string;
  readonly ownerEmail: string | null;
  readonly meetingDate: string | null;
  readonly prefix: string;
  readonly audioKey: string | null;
  readonly videoKey: string | null;
  readonly transcriptKey: string | null;
  readonly metadataKey: string | null;
  readonly summaryKey: string | null;
  readonly ingestionResultKey: string | null;
  readonly objectCount: number;
}

const historicalFirefliesKeyPattern = /^(raw\/fireflies\/(?:[^/]+\/)*transcript_id=([^/]+)\/)(.+)$/;

function parseHistoricalFirefliesKeyParts(key: string): {
  readonly ownerEmail: string | null;
  readonly meetingDate: string | null;
  readonly transcriptId: string | null;
  readonly fileName: string | null;
  readonly prefix: string | null;
} {
  const keyMatch = key.match(historicalFirefliesKeyPattern);
  const prefix = keyMatch?.[1];
  const transcriptId = keyMatch?.[2];
  const relativePath = keyMatch?.[3];
  if (!prefix || !transcriptId || !relativePath) {
    return {
      ownerEmail: null,
      meetingDate: null,
      transcriptId: null,
      fileName: null,
      prefix: null,
    };
  }

  const ownerEmail = key.match(/owner=([^/]+)/)?.[1] ?? null;
  const dateMatch = key.match(/year=(\d{4})\/month=(\d{2})\/day=(\d{2})/);
  const year = dateMatch?.[1];
  const month = dateMatch?.[2];
  const day = dateMatch?.[3];
  const fileName = relativePath.split("/").at(-1) ?? null;

  return {
    ownerEmail,
    meetingDate: year && month && day ? `${year}-${month}-${day}` : null,
    transcriptId,
    fileName,
    prefix,
  };
}

export function parseHistoricalFirefliesKey(key: string): {
  readonly ownerEmail: string | null;
  readonly meetingDate: string | null;
  readonly transcriptId: string | null;
  readonly fileName: string | null;
} {
  const parsed = parseHistoricalFirefliesKeyParts(key);
  return {
    ownerEmail: parsed.ownerEmail,
    meetingDate: parsed.meetingDate,
    transcriptId: parsed.transcriptId,
    fileName: parsed.fileName,
  };
}

export function buildHistoricalFirefliesInventory(
  keys: readonly string[],
): HistoricalFirefliesRecording[] {
  const byPrefix = new Map<string, HistoricalFirefliesRecording>();

  for (const key of keys) {
    const parsed = parseHistoricalFirefliesKeyParts(key);
    if (!parsed.transcriptId || !parsed.prefix) continue;
    const prefix = parsed.prefix;
    const existing = byPrefix.get(prefix) ?? {
      transcriptId: parsed.transcriptId,
      ownerEmail: parsed.ownerEmail,
      meetingDate: parsed.meetingDate,
      prefix,
      audioKey: null,
      videoKey: null,
      transcriptKey: null,
      metadataKey: null,
      summaryKey: null,
      ingestionResultKey: null,
      objectCount: 0,
    };
    const next = { ...existing, objectCount: existing.objectCount + 1 };
    if (/\.(mp3|m4a|wav|aac|flac)$/i.test(key)) next.audioKey = key;
    if (/\.(mp4|mov|webm|mkv)$/i.test(key)) next.videoKey = key;
    if (key.endsWith("/transcript.json")) next.transcriptKey = key;
    if (key.endsWith("/metadata.json")) next.metadataKey = key;
    if (key.endsWith("/summary.json")) next.summaryKey = key;
    if (key.endsWith("/ingestion-result.json")) next.ingestionResultKey = key;
    byPrefix.set(prefix, next);
  }

  return [...byPrefix.values()].sort(
    (left, right) =>
      left.transcriptId.localeCompare(right.transcriptId) ||
      left.prefix.localeCompare(right.prefix),
  );
}
