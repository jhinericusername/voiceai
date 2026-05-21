export interface RawTurn {
  readonly turnIndex: number;
  readonly speaker: "agent" | "candidate";
  readonly text: string;
  readonly questionId: string;
}

export interface AssembledTranscript {
  readonly version: "v1";
  readonly turns: readonly RawTurn[];
  readonly byQuestion: Record<string, RawTurn[]>;
}

// Builds the question-aligned, diarized transcript.v1.json content.
export function assembleTranscript(turns: readonly RawTurn[]): AssembledTranscript {
  const ordered = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
  const byQuestion: Record<string, RawTurn[]> = {};
  for (const turn of ordered) {
    (byQuestion[turn.questionId] ??= []).push(turn);
  }
  return { version: "v1", turns: ordered, byQuestion };
}
