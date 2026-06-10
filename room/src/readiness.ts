// The candidate is "ready" only when they can BOTH be heard (mic track
// published) and hear the agent (browser autoplay unblocked). The agent worker
// waits for this signal before speaking the opener.
export function isCandidateReady(micPublished: boolean, canPlaybackAudio: boolean): boolean {
  return micPublished && canPlaybackAudio;
}
