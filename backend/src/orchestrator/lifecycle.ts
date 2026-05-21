export type SessionStatus =
  | "scheduled"
  | "in_progress"
  | "recording_finalizing"
  | "review_ready"
  | "incomplete";

const ORDER: SessionStatus[] = [
  "scheduled",
  "in_progress",
  "recording_finalizing",
  "review_ready",
];

// The next status in the happy-path lifecycle; terminal statuses stay put.
export function nextSessionStatus(status: SessionStatus): SessionStatus {
  const index = ORDER.indexOf(status);
  if (index < 0 || index === ORDER.length - 1) return status;
  return ORDER[index + 1] as SessionStatus;
}

export function isTerminal(status: SessionStatus): boolean {
  return status === "review_ready" || status === "incomplete";
}
