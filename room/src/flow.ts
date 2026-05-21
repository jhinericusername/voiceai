export const ROOM_STEPS = [
  "landing",
  "consent",
  "preflight",
  "waiting",
  "incall",
  "completion",
] as const;

export type RoomStep = (typeof ROOM_STEPS)[number];

export function nextStep(step: RoomStep): RoomStep {
  const index = ROOM_STEPS.indexOf(step);
  const next = ROOM_STEPS[Math.min(index + 1, ROOM_STEPS.length - 1)];
  return next as RoomStep;
}

export interface CallGate {
  readonly consentGiven: boolean;
  readonly preflightPassed: boolean;
}

// The candidate may not enter the call — and recording may not begin —
// until AI disclosure consent is captured and the device preflight passes.
export function canEnterCall(gate: CallGate): boolean {
  return gate.consentGiven && gate.preflightPassed;
}
