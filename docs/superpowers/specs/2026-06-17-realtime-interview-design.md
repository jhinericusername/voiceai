# Realtime interview architecture — design spec

**Date:** 2026-06-17
**Status:** approved (brainstorm complete) — ready for implementation planning
**Branch:** prakul-script-extraction

## Context

We are moving the voice interviewer off the cascaded **Deepgram STT → Anthropic
scorer/probe → Cartesia TTS** pipeline onto a **realtime / speech-to-speech**
model (OpenAI `gpt-realtime`) for the spoken conversation. The 2026-06-16/17
spike (`docs/architecture/2026-06-16-realtime-spike-findings.md`) settled the two
biggest fears and is **not re-litigated here**:

- **Verbatim fidelity is high** in both text and audio — the model holds approved
  wording from instructions alone (EXACT on most graded questions) and even
  reuses the script's own probes verbatim.
- **Guardrails hold under direct pressure** — it cleanly deflects
  comp/protected-class/scoring asks and returns to script.

Two residual risks remain, and the design exists to close them:

1. **Coverage** — left to itself the model skips/bundles questions and improvised
   its own closing instead of the scripted one. → needs a **coverage backstop**.
2. **Subtle fabrication** — it invented company facts ("small collaborative
   pods, code reviews, stand-ups…") on an open question; the in-prompt guardrails
   missed it. → needs an **output guardrail monitor**.

This is a **hiring screen**, so script fidelity, candidate-to-candidate
comparability, deterministic scoring, and auditability are load-bearing (legal
defensibility). The design keeps all of that while letting the model own the
moment-to-moment conversation.

## Decisions locked in the brainstorm

| # | Decision | Choice |
|---|----------|--------|
| 1 | **Control model** | **Model drives, app backstops.** The model owns flow and probing from a full-script prompt; a tool-call control bus supplies authoritative wording and marks turn boundaries; `Scorer` + `decide_next_action` run **off-loop** for grading and exception-steering. App hard-gates **only at close**. No per-turn gating. |
| 2 | **v1 scope** | Core (full-script prompt + tool control bus + off-loop scorer + coverage backstop) **+ guardrail monitor**. |
| 3 | **Out of v1** | No provider seam (hard-code `gpt-realtime`), no deterministic-TTS verbatim fork, no second provider (Inworld/Gemini). |
| 4 | **Deliverable** | **Production code** — re-cast `InterviewRunner` + a new RealtimeModel-backed voice adapter. |
| 5 | **Validation** | An **automated eval harness against the real code** (adaptive-LLM candidate + ~15-min long-session drift), driving the runner over the raw OpenAI realtime websocket (no LiveKit room). |
| 6 | **Halt line (manual-gate)** | Build + test everything in code, including automated self-tests that hit the OpenAI realtime API with the dev key (no room, no candidate). **HALT before** any ECS deploy / task-def roll **and** any live LiveKit room run with a real candidate. |

## Architecture overview

The realtime model **owns the spoken conversation**; the app owns the **plan, the
authoritative wording, and the safety net**, applied out-of-band. Three planes:

- **Speech plane (synchronous, native):** candidate audio ↔ `gpt-realtime` audio,
  via the LiveKit OpenAI `RealtimeModel`. No STT/TTS cascade in the path.
- **Control plane (cheap, in-path):** the model calls tools to signal intent; the
  app answers with authoritative text — fast local lookups, **no LLM in the
  round-trip**.
- **Analysis plane (async, off-path):** the existing scorer/probe logic grades
  completed Q&A blocks and fires *exception* steering; a new guardrail monitor
  watches output turns. Both inject out-of-band messages; neither blocks speech.

```
                 ┌─────────────────── Speech plane (native, sync) ───────────────────┐
   candidate ───▶│  gpt-realtime  ◀──▶  RealtimeVoiceSession (LiveKit RealtimeModel) │───▶ candidate
                 └────────────┬───────────────────────────────────┬──────────────────┘
                              │ tool calls / transcripts           │ inject_message()
                   ┌──────────▼──────────┐               ┌─────────┴──────────┐
                   │   Control bus       │               │  Analysis plane    │
                   │  (in-path, local)   │               │  (async, off-path) │
                   │  advance_question   │  Q&A block     │  Scorer + decide_  │
                   │  request_probe      │ ─────────────▶ │  next_action       │──┐
                   │  flag_off_script    │  snapshot      │  (steer by excep.) │  │ inject
                   │  close_interview    │               │  Guardrail monitor  │──┘ steering/
                   │  (coverage backstop)│  output turn  │  (Haiku watcher)    │    correction
                   └──────────┬──────────┘ ─────────────▶└────────────────────┘
                              │ EventLog + emitters (transcript / agent_event / score_checkpoint)
                              ▼
                     roll_up_assessment → finalization
```

## Components

### A. Plan-builder *(new — pure function)*

`Rubric → (instructions, tool_schemas, required_coverage_set)`. Compiles the
script into the realtime model's system instructions:

- Persona: Prakul, engineer at Weave; the screen's purpose.
- Ordered **verbatim** questions + their `scripted_probes`, opener/closer
  verbatim, the YC `pre_question` gate framing.
- Ordering rule; tool-usage instructions (how/when to call the control bus).
- Guardrails: no comp/start-date, no protected-class, no scoring leakage, no
  commitments, **no inventing company facts** (the spike's fabrication mode).

`required_coverage_set` = every `rubric.questions` entry (+ the opener's
"tell me about yourself" ask and the closer's logistics questions). There is no
separate "required" flag in the rubric today; every scripted question is
required. Pure and unit-testable with **zero model calls**.

### B. RealtimeVoiceSession *(new — replaces `LiveKitSessionVoiceAgent`'s cascade)*

A narrow interface over the realtime plugin. Surfaces:

- candidate **input** transcription (turns),
- agent **output** transcription with **turn boundaries**,
- model **tool-call** events,
- `inject_message(text)` — out-of-band steering/correction,
- `respond_to_tool(call_id, result)` — answer a tool call.

Ports today's participant lifecycle (reconnect grace, candidate-ready gate) from
`LiveKitSessionVoiceAgent`. **Behind an interface** (`RealtimeSession` protocol)
so the same re-cast runner can be driven by:

1. the production LiveKit `RealtimeModel` adapter, and
2. a raw OpenAI realtime websocket adapter used by the eval harness (the spike's
   transport — no LiveKit room).

Note: this is a **transport seam** (LiveKit room vs. raw websocket, both OpenAI
`gpt-realtime`) needed for the eval harness — **not** the *provider* seam we
explicitly cut from v1 (decision #3). Both adapters speak to the same provider.

### C. Control bus *(new — tool handlers inside the re-cast runner)*

| Tool | Handler behavior |
|------|------------------|
| `advance_question(next_id)` | Validate order. If it would skip an uncovered required question → steer back with that question's verbatim. Else: mark previous covered, **snapshot the completed Q&A block** for the scorer, return the authoritative verbatim of `next_id`. Keeps sequence + wording app-authoritative; the model controls *timing*. |
| `request_probe(category)` | Return a scripted/generated probe via the existing `ProbeGenerator` (scripted-first, LLM tail). Log it. |
| `flag_off_script(reason)` | Log for audit. Return a canonical deflection line. |
| `close_interview()` | Run the **coverage backstop**: all required covered → return scripted closer verbatim and end; gaps → **deny**, hand back the missing question's verbatim. **The one hard gate.** |

`decide_next_action` is **not** in the tool path — it runs off-loop (D).

### D. Off-loop scorer + steering-by-exception *(reuse)*

Each snapshotted Q&A block → `Scorer` async (existing `asyncio.to_thread`
pattern) → score checkpoint (existing emit). Then `decide_next_action`: if a
target category is under-covered (low confidence) **and** the model already
advanced without probing it → enqueue a **one-off** steering nudge ("before you
wrap, dig deeper on `<category>`"). `Scorer` / `decide_next_action` /
`ProbeGenerator` / the score-checkpoint emit are **reused unchanged** — only
repositioned from a per-turn gate to an exception signal.

### E. Guardrail monitor *(new — the one new analytic piece)*

A cheap async watcher (Claude Haiku) on each agent **output** turn, checking for
fabricated company facts / off-script claims / commitments / protected-topic
leakage. On a hit → `inject_message()` a correction ("don't describe team/company
specifics you weren't given; correct or move on") **and** log a guardrail event.
Off the speech path; best-effort; never blocks speech.

## InterviewRunner re-cast

`run(session_id)` becomes:

1. Build the plan (A).
2. Start `RealtimeVoiceSession` with instructions + tool schemas (B).
3. Drive an event loop dispatching:
   - tool-calls → control bus (C),
   - completed Q&A blocks → off-loop scorer (D),
   - agent output turns → guardrail monitor (E),
   - input/output transcripts → existing emitters,
   until `close_interview` clears the backstop **or** a terminal condition fires.
4. `roll_up_assessment` (unchanged) → existing finalization.

**Kept as-is:** `EventLog` + emitters (transcript_turn / agent_event /
score_checkpoint) + `BackendClient`; the state machine (re-mapped to the new
flow); `InterviewClock` / total cap; participant lifecycle; rollup;
finalization completion-reasons.

## Auditability

Extend the event log to record, in addition to today's utterances:

- the **compiled instructions** handed to the model (once, at session start, as
  an artifact),
- every **tool-call + app response**,
- every **steering injection** and **guardrail correction**, with reason,
- per-required-question **coverage status** at close.

New `ReasonCode`s: `REALTIME_QUESTION` (model-asked, app-authoritative verbatim),
`STEER`, `GUARDRAIL_CORRECTION`, `COVERAGE_BACKSTOP`. Together these reconstruct
**what was asked and why**, even though the model owns the flow.

## Safe cutover

The cascade (Deepgram/Cartesia) is **not ripped out**. The realtime path lands
**behind a flag** (env / `script_version`), so both coexist in production code
and the proven cascade remains a fallback. Actual cutover = a deploy =
**manual-gate, separate session**. This is consistent with "straight to
production wiring" while keeping a working fallback until the realtime path is
validated live.

## Error handling

- **Realtime disconnects / session errors** → existing reconnect-grace +
  completion-reasons (`candidate_disconnected` / `timeout` / `agent_error`).
- **Model misbehavior** (won't advance / loops / ignores steering) → bounded by
  the coverage backstop + `InterviewClock` total cap + a **max-duration guard**
  that forces close.
- **Malformed tool args** → return an error tool-result + log; never crash the
  loop.
- **Scorer / monitor failures** → best-effort, never block the speech path
  (existing pattern).

## Testing & validation

- **Unit:** plan-builder (Rubric → instructions / tools / coverage set);
  control-bus handlers (advance ordering, backstop deny, probe routing,
  off-script logging); guardrail monitor (catches seeded fabrication, ignores
  clean turns); steering-trigger logic.
- **Integration:** the re-cast runner against a **fake `RealtimeVoiceSession`**
  (scripted tool-call + transcript event sequences) — exercises the full loop
  with no network: coverage backstop forces a missed question, scoring fires,
  emitters called, finalization correct.
- **Eval (live API, dev key, on-demand — not in default CI):**
  - **adaptive-LLM candidate** (answers the *current* question) → clean
    coverage / order / wording-fidelity numbers (reuse the spike's difflib +
    Claude grader);
  - **~15-min long-session** drift / instruction-decay test;
  - **guardrail catch-rate** (does the monitor catch seeded fabrication?);
  - **backstop behavior** (does close get denied until missing questions are
    asked?).
  - Results appended to `docs/architecture/2026-06-16-realtime-spike-findings.md`
    (or a dated follow-up findings doc).

## Open risk to verify first (Q4)

The design assumes the LiveKit OpenAI `RealtimeModel` plugin surfaces
input+output transcription, tool-call events, and out-of-band message injection.
**The first task of the integration phase verifies this against the plugin API.**
The raw-websocket eval harness exercises the same primitives independently, so
the mechanism is validated even if the LiveKit wrapper differs. If out-of-band
injection isn't supported, the fallback is `session.update` / a queued user
message.

## What changes vs. what stays

**Rewritten:**
- `agent/src/agent/voice/livekit_session.py` (`LiveKitSessionVoiceAgent`) →
  `RealtimeVoiceSession` (new RealtimeModel-backed adapter + interface).
- `agent/src/agent/controller/interview.py` (`InterviewRunner`) — orchestration
  goes from turn-driver to plan-builder + control-bus + backstop + steering.
- `agent/src/agent/worker/entrypoint.py` — builds the `RealtimeModel` (flagged)
  instead of the STT/TTS cascade.

**Reused unchanged (load-bearing investment preserved):**
- rubric + loader, `Scorer`, `ProbeGenerator`, `decide_next_action`,
  `roll_up_assessment`, `EventLog` + emitters + `BackendClient`, the state
  machine (re-mapped), `InterviewClock`, participant-lifecycle logic,
  finalization/completion-reasons, domain types (extended with new
  `ReasonCode`s).

## Out of scope (explicit)

- Provider abstraction / Inworld / Gemini Live.
- Deterministic-TTS verbatim fork for legally-sensitive questions.
- Any deploy, ECS roll, or live run with a real candidate (manual-gate).
- Deleting the cascade pipeline (kept as flagged fallback).
