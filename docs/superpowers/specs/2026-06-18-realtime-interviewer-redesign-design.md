# Realtime Interviewer Redesign — Design Spec

**Date:** 2026-06-18
**Status:** Approved (brainstorm)
**Branch:** `prakul-script-extraction`
**Supersedes the live-scoring parts of:** `2026-06-17-realtime-interview-design.md`

## Problem

The 2026-06-17 realtime build put the live Anthropic `Scorer` + `decide_steering`
*inside* the interview loop. This is wrong on two counts:

1. **Latency (confirmed in code).** `controller/realtime/runner.py` drives a single
   `async for event` loop (≈L158–173). It `await`s the guardrail check inline in
   `_on_agent_turn` (≈L205) and the scorer + steering inline in `_on_candidate_turn`
   (≈L244–281). `asyncio.to_thread(...)` moves the work off-thread but it is still
   awaited before the loop processes the next event, so ~1–3 s of Anthropic latency
   sits directly in front of the model's `respond_to_tool` speak path. The model
   waits on `advance_question`'s verbatim text to speak the next question → slow
   interviewer. Backgrounding it would be a band-aid.

2. **Wrong architecture.** Scoring does not belong in the interview at all. A
   complete post-interview grading pipeline already exists in the **backend**
   (Prakul's), and it is the source of truth:
   `backend/src/grading/scoring.ts` → `scoreTranscript(input, model)` on AWS Bedrock
   (`bedrock.ts`), scoring each rubric category with verbatim evidence quotes and
   treating the transcript as untrusted (prompt-injection defense).

The agent's Python `scoring/scorer.py` is redundant/divergent with the backend
grader. It is the cascade's *entire* probe-vs-advance brain (see below), which is
why removing it is a redesign, not a deletion.

## Decision (the four forks, resolved with the user)

1. **Depth is the model's job, from completeness exemplars** — not a numeric score.
   Each question's instructions describe *what a complete answer looks like* and
   *when to stop probing / signs of completion*. No live score, no threshold, no
   in-loop model call decides depth.
2. **Guardrail = prevent-in-instructions + non-blocking monitor.** Hard guardrail
   rules live in the model's instructions (the spike showed this works). The monitor
   is made non-blocking: it logs violations to the event log and may inject a
   *next-turn* correction, but never gates the speak path. We accept that a rare leak
   can reach the candidate but is caught and corrected.
3. **One path, no fallback.** The realtime model becomes *the* interviewer. The
   cascade is retired. We invest in making the realtime path production-grade rather
   than hedging behind the cascade.
4. **All scoring is post-hoc, in the backend.** The live interviewer's sole
   deliverable is a clean transcript; `scoreTranscript` grades it after the call.

### Why "strip the cascade" became "retire the cascade"

The cascade and the realtime model are **not symmetric**. The realtime model is a
single brain that decides "probe or advance" natively from its instructions. The
cascade has **no dialogue brain**: `controller/decision.py` `decide_next_action()`
reads the scorer's per-category *confidence* and that is the entire probe-vs-advance
decision. Removing the scorer from the cascade would lobotomize it (it could only
probe a fixed number of times then advance, with no quality judgment) unless we built
a *new* live decision component — which reintroduces the very latency we are removing.
Given that, the user chose: no fallbacks — make the realtime path work and retire the
cascade.

## Solution overview

A single realtime S2S interviewer whose only output is a clean, speaker-attributed,
ordered transcript. Two guarantees, two mechanisms:

- **Coverage** ("every required question is *asked*, verbatim") = **hard control**
  (`coverage` tracker + `control_bus` backstop). The model cannot skip a required
  question or improvise a close while one is uncovered.
- **Depth** ("is this answer complete, or do we probe") = **the model's judgment**,
  from per-question completeness exemplars + scripted probes via `request_probe`.

The trade is deliberate: coverage is guaranteed; depth is trusted to the model. There
is no hard depth guarantee anymore — accepted because you cannot re-ask after the
call and the spike showed the model probes well.

## Components

### Kept (nothing inline on the speak path)
- **Realtime model + instructions** — verbatim questions, per-question completeness
  exemplars, hard guardrail rules.
- **`control_bus`** tool handlers — `advance_question` / `request_probe` /
  `flag_off_script` / `close_interview` + the **verbatim coverage backstop**.
- **`coverage`** tracker — asked-verbatim guarantee.
- **`guardrail_monitor`** — made **non-blocking**: fire-and-forget, logs violations to
  the event log, may inject a next-turn correction; never gates speech.
- **Transcript emit** — `worker/backend_client.post_transcript_turn` →
  `POST /internal/sessions/{id}/transcript-turns` → `transcripts/repository.ts`
  `INSERT INTO transcript_turns` → grader reads
  `grading/repository.ts` `... ORDER BY turn_index`. Pipeline already wired
  end-to-end for the realtime runner (`worker/entrypoint.py` ≈L280).

### Removed
- `scorer.score` live call in `runner.py` `_on_candidate_turn` + the inline `await`
  that caused the latency.
- `decide_steering` (scorer-driven) and the realtime `steering.py` usage that depends
  on scorer output.
- live `score_checkpoint` emission (realtime and cascade).
- the **entire cascade** `controller/interview.py` `InterviewRunner` + `decision.py` +
  scorer-as-brain, and the `PUDDLE_USE_REALTIME` flag (realtime *is* the path; the
  entrypoint no longer flag-selects).

### Retained outside the interview
- The Python `scoring/scorer.py` is **kept for the offline eval harness** (corpus
  scoring), which is a separate concern from the live interview. It is no longer
  called live by any interview path.

## Candidate-behavior → control taxonomy

The rule: conversational nuance → the model; anything script- or safety-critical →
a hard, deterministic control that never depends on an in-loop model judgment.

| Candidate behavior | Owner | Mechanism |
|---|---|---|
| Thin / vague answer | Model | completeness exemplars → `request_probe` (scripted probe) |
| Rambling / off-topic | Model | instructions: acknowledge, redirect, return to question |
| Silence / no response | **Hard** | reprompt timer → after N attempts, `advance_question` |
| Asks score / comp / protected-class | **Hard** | guardrail rule → deflect ("the team will follow up"); monitor logs |
| Asks unknown company fact | Model + guardrail | "don't fabricate; team will follow up"; monitor flags fabrication post-turn |
| Hostile / abusive | **Hard** | graceful end via `close_interview` |
| Asks to repeat the question | Model | re-ask verbatim |
| Tries to skip a question | **Hard** | coverage backstop forces the ask |
| Model itself drifts off-script | **Hard** | `flag_off_script` + coverage backstop |

## Data flow / transcript contract

`scoreTranscript` consumes `TranscriptTurnLike { speaker, text, turnIndex? }` — a
flat, speaker-attributed, ordered list; **no per-question segmentation required**. The
realtime path already emits the richer `TranscriptTurn { turn_index, speaker, text,
question_id, unreliable }` (`domain/types.py`). The contract is therefore already met;
`question_id`/`unreliable` are a bonus the grader currently ignores (useful for review/QA).

The design *requirement* shifts from "the score is right" to **"the transcript is
clean and complete"**:
- every turn captured, including probes and backstop re-asks
- correct agent/candidate attribution
- correct ordering (`turn_index` monotonic)

This becomes the eval's primary metric.

## Error handling

- **Guardrail monitor failure** — fail-open (already the behavior); a monitor error
  must never block or crash the interview.
- **Backstop** — if the model attempts to close or advance past an uncovered required
  question, force the verbatim ask (existing `control_bus` behavior).
- **Silence** — reprompt up to N attempts, then `advance_question`; the turn is still
  recorded (possibly as `unreliable`).
- **Transcript persistence failure** — `post_transcript_turn` is best-effort and must
  not block the speak path; failures are logged. (Confirm ret/buffer behavior in the
  plan; the transcript is the deliverable, so a persistence gap is the highest-impact
  failure mode and warrants at least a buffered retry.)

## Testing strategy

- Repurpose the realtime eval harness (`eval/realtime/*`): primary metrics become
  **transcript quality** (completeness, required-question coverage, attribution
  correctness) + **guardrail leak rate** — not live-score fidelity.
- Build a genuinely **adaptive mock candidate** (the current thin driver bypassed the
  backstop) to exercise probing-depth and the coverage backstop.
- **End-to-end:** feed eval transcripts through backend `scoreTranscript` to confirm
  realtime transcripts grade cleanly.
- Unit coverage for: non-blocking guardrail (no await on the speak path), backstop
  forcing coverage, silence reprompt→advance, transcript completeness incl. probes.

## Manual-gate operations (halt the autonomous run)

- Flipping the deployed default to realtime + retiring the cascade = **deploy/release**.
- Live LiveKit room smoke test.
- Running an interview with a real candidate.

(Per repo `CLAUDE.md`. The autonomous build run stops for operator approval before any
of these.)

## Open items to settle in the plan (not blockers)

- **Silence/reprompt constants** — timeout duration, N attempts.
- **Completeness-exemplar content per question** — sourced from the rubric + Prakul's
  2026-06-15 reference script (`docs/interviews/2026-06-15-prakul-screen-reference.*`).
- **Transcript persistence robustness** — confirm buffered-retry on
  `post_transcript_turn` since the transcript is now the sole deliverable.
- **`flag_off_script` consumer** — confirm what records/acts on off-script flags now
  that the guardrail monitor is non-blocking.

## Non-goals

- Replacing the backend grader or changing the rubric.
- Building a new live quality/thinness signal (explicitly rejected — depth is the
  model's job).
- Keeping the cascade as a maintained fallback.
- Changing the TTS/voice-clone path (tracked separately).
