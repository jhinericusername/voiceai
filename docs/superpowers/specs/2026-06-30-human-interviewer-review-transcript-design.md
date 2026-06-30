# Human Interviewer Review Transcript Design

## Goal

Ingest human interviewer speech from the LiveKit interview room and show it in the dashboard transcript panel without allowing that speech to affect grading.

The current durable transcript path is intentionally two-speaker and grading-oriented: `agent` and `candidate` turns are persisted to `transcript_turns`, and the grading recommendation route reads that table. Human interviewer audio is visible to LiveKit as a participant, but it is not transcribed into the review packet.

## Requirements

- Persist human interviewer speech from LiveKit `interviewer-*` participants.
- Present human interviewer turns in the dashboard interview transcript panel alongside candidate and AI interviewer turns.
- Keep human interviewer speech out of grading prompts and scoring artifacts.
- Preserve existing candidate and AI agent transcript behavior.
- Make ingestion best-effort; a human interviewer transcription failure must not crash or end the AI interview.
- Keep enough metadata to debug source attribution: speaker, LiveKit participant identity, source, timestamps, and optional track identity.

## Non-Goals

- Do not grade human interviewer speech.
- Do not make the realtime model listen to the human interviewer.
- Do not replace room composite recording.
- Do not build browser-side transcription as the system of record.

## Recommended Architecture

Add a review-only transcript stream beside the existing grading transcript.

`transcript_turns` remains the grading transcript. It keeps the current speaker domain and continues to drive final artifacts and `/grading/recommendations/session/:sessionId`.

Add a new backend table, tentatively `review_transcript_turns`, for dashboard display. It supports `agent`, `candidate`, and `human_interviewer` speakers and stores participant/source metadata. The dashboard reads from this table when rows exist, falling back to `transcript_turns` for older sessions.

The agent worker mirrors existing AI agent and candidate turns into the review transcript table. A new sidecar transcriber listens to LiveKit human interviewer audio tracks, transcribes final segments, and posts them to the backend as `human_interviewer` review transcript turns.

## Data Model

Create a migration for a review-only transcript table:

- `session_id`
- `turn_index`
- `speaker`: `agent`, `candidate`, or `human_interviewer`
- `text`
- `occurred_at`
- `offset_ms`
- `source`
- `participant_identity`
- `track_sid`
- `question_id`
- timestamps

Use `(session_id, turn_index)` as the primary key or use a sequence allocator that keeps review transcript ordering stable across multiple sources. The implementation plan should decide the exact ordering strategy; the requirement is monotonic, deterministic display order.

Do not alter the allowed speaker set of `transcript_turns`.

## Backend API

Add an internal endpoint for review transcript turns:

`POST /internal/sessions/:sessionId/review-transcript-turns`

The endpoint validates:

- `turnIndex` is a non-negative integer.
- `speaker` is one of `agent`, `candidate`, `human_interviewer`.
- `text` is non-empty.
- `participantIdentity`, `trackSid`, `source`, and `questionId` are optional non-empty strings.
- `occurredAt` and `offsetMs` follow the same rules as existing transcript turn ingestion.

Existing internal auth applies through the current backend route registration.

## Agent Worker Ingestion

Add a review transcript client method to `BackendClient`, similar to `post_transcript_turn`, with bounded buffering and best-effort failure handling.

For existing AI/candidate turns, wire the realtime runner or worker to emit a second copy to the review endpoint. This keeps review transcript completeness independent of human interviewer STT.

For human interviewer turns, add a worker sidecar that:

- Detects LiveKit participants whose identity starts with `interviewer-`.
- Subscribes to their audio tracks.
- Runs streaming STT over the audio frames.
- Emits final transcript segments as `human_interviewer` review turns.
- Cancels cleanly when the worker closes or the participant disconnects.

The sidecar must not feed human interviewer audio into the realtime model. The realtime model should remain bound to the candidate participant.

## Dashboard

Update backend dashboard interview detail to return `review_transcript_turns` when present. The platform dashboard transcript panel should support a third speaker and label it as `Human interviewer`.

Display behavior:

- `Agent` or current `Interviewer` label for the AI interviewer should be made unambiguous.
- `Candidate` remains unchanged.
- `Human interviewer` appears for human host speech.
- Playback seeking continues to use `offsetMs` or `occurredAt` where available.

## Grading Boundary

The grading route must continue reading only `transcript_turns`. Do not join or merge `review_transcript_turns` into `transcriptTurnsForSessionStatement`.

Tests should explicitly prove a stored `human_interviewer` review turn is not included in the scoring prompt input.

## Testing

Use test-first implementation.

Backend tests:

- Validate review transcript turn payloads.
- Upsert review transcript rows.
- Dashboard detail prefers review transcript rows when available.
- Grading repository still reads only `transcript_turns`.

Agent tests:

- Identify interviewer participants by `interviewer-` prefix.
- Human interviewer final STT segments emit `human_interviewer` review turns.
- Candidate-bound realtime session still filters to `candidate-` participants.
- Sidecar failures are logged/buffered and do not fail interview finalization.

Platform tests:

- Transcript panel accepts and labels `human_interviewer`.
- Existing two-speaker sessions still render.

## Rollout

Adding the migration is safe to prepare in code, but applying it is a manual-gate operation under repo instructions. The implementation should not apply the migration automatically.

For sessions created before this change, the dashboard falls back to the existing transcript rows. For new sessions after migration and deploy, the review transcript table becomes the dashboard source of truth.

## Risks

The main technical risk is turn ordering across independent transcript producers. The implementation should centralize turn index assignment on the backend or use an ordering key that cannot collide.

The second risk is double-transcribing the candidate or accidentally binding the realtime model to the interviewer. Keep identity filters explicit and test candidate/interviewer separation.

The third risk is cost and latency from an extra STT stream. This is acceptable for review-only ingestion, but failures should degrade to missing human interviewer transcript rows rather than affecting the interview.
