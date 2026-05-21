// A session is due for worker pre-warm when its scheduled start is within the
// lead window from now but has not yet passed.
export function dueForPrewarm(
  scheduledAtIso: string,
  nowMs: number,
  leadWindowMs: number,
): boolean {
  const startMs = Date.parse(scheduledAtIso);
  const msUntilStart = startMs - nowMs;
  return msUntilStart > 0 && msUntilStart <= leadWindowMs;
}
