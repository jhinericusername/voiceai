# Streaming Interview Artifacts Design

## Context

The local connected interview flow does not depend on `app.usepuddle.com` for the candidate UI. A localhost dashboard can create and join an interview through the dev backend tunnel. The media path is already streaming through LiveKit, and LiveKit Egress uploads the composite video to S3 after the room ends.

The gap is artifact durability. Candidate transcripts, agent utterances, scoring outputs, and final review packet state currently live mostly inside the agent process until the interview completes. In the inspected run, LiveKit produced `composite.mp4` and the backend marked `composite_video` available, but `transcript_turns` and `assessments` stayed empty.

## Current Evidence

- STT provider: `agent/src/agent/voice/stt.py` builds `deepgram.STT(model="nova-3", api_key=api_key, interim_results=True)`.
- Runtime voice path: `agent/src/agent/voice/livekit_session.py` creates `AgentSession(stt=stt, tts=tts, llm=None)` and listens for `user_input_transcribed`.
- Candidate words are available live: final candidate transcripts are queued by `_on_user_input_transcribed` and consumed by `LiveKitSessionVoiceAgent.listen()`.
- The controller builds an in-memory transcript: `agent/src/agent/controller/interview.py` appends agent and candidate `TranscriptTurn`s.
- Backend already has SQL builders for durable transcript turns: `backend/src/transcripts/repository.ts`.
- Backend internal reporting currently accepts only generic lifecycle events at `POST /internal/sessions/:sessionId/events`.
- Existing related plan: `../docs/superpowers/plans/2026-06-10-complete-interview-artifacts.md` covers post-call packet assembly, but it should be tightened so transcript and scoring persistence are durable during the call.

## Goals

1. A 20-minute interview must not depend on one final API call for transcript, agent events, or scoring durability.
2. Candidate transcript turns must persist shortly after they are finalized by STT.
3. Agent utterances must persist when spoken, with reason code, question ID, and turn index.
4. Per-question scoring checkpoints must persist after each scored question or probe cycle.
5. Finalization must be idempotent and able to recover from partial progress.
6. LiveKit Egress remains the source of truth for composite video.
7. Normal interview completion must close the agent session promptly instead of waiting for reconnect grace.

## Non-Goals

- Do not replace LiveKit Egress for video recording.
- Do not add raw per-participant media tracks in this pass.
- Do not score on voice tone, facial expression, or emotion.
- Do not block the live interview on backend writes. Persistence failures should retry or buffer without breaking media.

## Approaches Considered

### A. Final Payload Only

The agent posts transcript, assessment, and events after `runner.run()` returns.

Pros: simplest API surface.

Cons: loses durability if the agent process crashes after a long interview; leaves no partial review packet; delays dashboard visibility; does not address the user's 20-minute concern.

### B. Near-Real-Time Persistence With Final Manifest

The agent posts transcript turns, agent events, and scoring checkpoints as the interview progresses. At the end, it posts a small finalization request that seals existing records, writes JSON/JSONL artifacts, and marks the review packet ready when required artifacts are present.

Pros: durable during long interviews; simple HTTP API; works with current Fastify backend and Postgres tables; does not require a queue service; recovery is straightforward.

Cons: requires idempotency keys and retry behavior; backend gets more write traffic.

### C. Queue-Backed Event Stream

The agent writes all interview events to SQS/Kinesis/EventBridge, and backend workers consume asynchronously.

Pros: strongest isolation and replay model; best for high volume.

Cons: larger infrastructure change; slower to ship; overkill for current dev-stage volume.

## Recommendation

Implement approach B now. It fixes the durability problem without changing the LiveKit media architecture. Keep the payloads small and idempotent. Add a queue later only if write volume or cross-service reliability demands it.

## Proposed Architecture

### Live Media

Candidate browser and agent continue streaming over LiveKit WebRTC. The backend starts RoomComposite Egress when the candidate joins. Egress writes `media/composite.mp4` to the artifacts bucket and reports completion through the LiveKit webhook.

### Transcript Stream

The agent emits a transcript turn to backend whenever the controller appends a turn:

- Agent turn: after `_say()` finishes playout and appends the `TranscriptTurn`.
- Candidate turn: after `listen()` returns a final STT transcript and the controller appends the `TranscriptTurn`.

The backend upserts by `(session_id, turn_index)`. This keeps retries safe and preserves ordering.

### Agent Event Stream

The agent emits an event when it records a spoken utterance:

- utterance
- reason code
- question ID
- category
- missing element
- turn index
- occurred at

The backend stores these both as operational events and as the future `agent_events.jsonl` source.

### Scoring Checkpoints

After each question's scoring step, the agent posts a checkpoint:

- question ID
- latest category assessments for that question
- confidence
- evidence quotes
- missing or ambiguous items
- model name/version
- checkpoint sequence

The backend stores these checkpoints in a new table or in `events` with a distinct kind. The final assessment is derived from the latest checkpoint state, then written to `assessments` and `recording_artifacts`.

### Finalization

At normal interview completion, the agent posts a finalization request containing:

- final transcript turn count
- final assessment summary
- integrity flags
- agent event count
- model/provider metadata
- completion reason: `completed`, `candidate_disconnected`, `agent_error`, or `timeout`

The backend finalizer:

1. Re-reads persisted transcript turns, agent events, and scoring checkpoints from Postgres.
2. Writes `transcripts/transcript.v1.json`.
3. Writes `events/agent_events.jsonl`.
4. Writes `assessment/scores.json`.
5. Writes `assessment/integrity_flags.json`.
6. Marks required non-video artifacts available.
7. If `composite_video` is already available, marks session `review_ready`.
8. If video is not complete yet, leaves session `recording_finalizing`; the LiveKit webhook runs the same readiness gate later.

## Backend API Shape

All routes require the existing internal bearer token.

### `POST /internal/sessions/:sessionId/transcript-turns`

Request:

```json
{
  "turnIndex": 3,
  "speaker": "candidate",
  "questionId": "q2",
  "text": "I changed the deployment plan after the first design failed.",
  "occurredAt": "2026-06-11T04:18:22.000Z",
  "offsetMs": 124000,
  "source": "deepgram:nova-3",
  "unreliable": false
}
```

Behavior:

- Validate session ID, turn index, speaker, and text.
- Upsert with `transcriptTurnUpsertStatement`.
- Persist an audit/ops event like `transcript_turn_persisted`.
- Return `202`.

### `POST /internal/sessions/:sessionId/agent-events`

Request:

```json
{
  "sequence": 4,
  "turnIndex": 4,
  "utterance": "Can you walk me through the tradeoff?",
  "reasonCode": "PROBE_LOW_CONFIDENCE",
  "questionId": "q2",
  "category": "technical_depth",
  "missingElement": "tradeoff analysis",
  "occurredAt": "2026-06-11T04:18:31.000Z"
}
```

Behavior:

- Upsert or idempotently insert by `(session_id, sequence)`.
- Keep enough metadata to rebuild `agent_events.jsonl`.

### `POST /internal/sessions/:sessionId/score-checkpoints`

Request:

```json
{
  "sequence": 2,
  "questionId": "q2",
  "model": "claude-*",
  "assessments": [
    {
      "category": "technical_depth",
      "provisionalScore": 3,
      "confidence": 0.74,
      "evidenceQuotes": ["I changed the deployment plan..."],
      "missingOrAmbiguous": ["failure mode depth"]
    }
  ]
}
```

Behavior:

- Store latest score state without requiring the interview to end.
- Return `202`.

### `POST /internal/sessions/:sessionId/finalize`

Request:

```json
{
  "completionReason": "completed",
  "scriptVersion": "pilot-v1",
  "finalTurnCount": 10,
  "integrityFlags": [],
  "agentEventCount": 8
}
```

Behavior:

- Idempotently build artifacts from persisted state.
- Mark artifact statuses and run the review-ready gate.
- Close out incomplete sessions when completion reason is not `completed`.

## Agent Changes

1. Add a small async backend client that supports retry with bounded queueing:
   - fire-and-forget during live interview
   - flush pending writes before finalization
   - log and continue if a non-critical live write fails
2. Change `InterviewRunner._say()` to emit agent transcript and agent event records after successful playout.
3. Change `InterviewRunner._listen()` to emit candidate transcript records after final STT turns.
4. Change question scoring flow to emit score checkpoints after each scoring result.
5. Change worker entrypoint `finally` handling:
   - flush backend client
   - post finalization
   - call `voice.aclose()`
   - ensure the LiveKit session closes promptly after normal completion

## Backend Changes

1. Add route handlers for transcript turns, agent events, score checkpoints, and finalization.
2. Add repositories/tables for agent events and score checkpoints if `events` is not structured enough.
3. Make finalization read from durable tables rather than trusting the final request body.
4. Make the LiveKit egress webhook and finalization endpoint call the same `maybeMarkReviewReady(sessionId)` function.
5. Add dashboard read endpoints once real packet data is available.

## State Model

- `in_progress`: interview live, streaming transcript/checkpoints expected.
- `recording_finalizing`: candidate/agent interview has ended; waiting for video and/or artifact packet.
- `review_ready`: composite video plus transcript, scores, integrity flags, and agent events are available.
- `incomplete`: interview ended before enough evidence was collected; partial artifacts remain available.

## Failure Handling

- Backend temporarily unavailable: agent buffers a bounded number of writes and retries. If the buffer overflows, log an ops event and mark transcript gaps in finalization.
- Agent crashes mid-interview: persisted transcript/checkpoints up to the crash remain available; egress still finalizes video when the room closes.
- Finalization called before egress finishes: non-video artifacts become available; session stays `recording_finalizing`.
- Egress finishes before finalization: composite becomes available; session stays `recording_finalizing`.
- Duplicate posts: all live persistence endpoints are idempotent by session plus sequence or turn index.
- Transcript source uncertainty: persist `source = deepgram:nova-3` and `unreliable` where available.

## Testing Plan

### Agent Unit Tests

- Final candidate STT event emits exactly one candidate transcript turn.
- Agent utterance emits transcript turn and agent event after playout.
- Backend client retries transient failures without blocking `listen()` or `speak()`.
- Finalization flushes pending records before closing the LiveKit session.

### Backend Unit Tests

- Transcript turn endpoint validates payloads and upserts idempotently.
- Agent event endpoint handles duplicate sequence numbers.
- Score checkpoint endpoint stores latest checkpoint data.
- Finalization builds JSON/JSONL artifacts from persisted database rows.
- Review-ready gate requires composite video, transcript, scores, integrity flags, and agent events.

### Integration Tests

- Simulated 20-minute interview with many transcript turns never uses a long-running HTTP request.
- Kill the agent after question 2 and verify persisted transcript/checkpoints remain queryable.
- Complete a normal interview and verify:
  - room closes promptly
  - egress finalizes to S3
  - transcript rows exist
  - assessment exists
  - required artifacts are available
  - session reaches `review_ready`

## Open Product Decisions

1. Should the dashboard show partial live transcript while the interview is in progress, or only use it internally for recovery?
2. Should score checkpoints be reviewer-visible, or should reviewers only see the final rolled-up assessment?
3. How aggressively should we retry live persistence before marking a transcript gap?

## Recommended Next Step

Turn this design into a detailed implementation plan that updates or replaces `../docs/superpowers/plans/2026-06-10-complete-interview-artifacts.md`. The implementation should start with the backend transcript-turn endpoint and agent transcript emission because that creates the smallest end-to-end proof that a long interview is not dependent on one final API call.
