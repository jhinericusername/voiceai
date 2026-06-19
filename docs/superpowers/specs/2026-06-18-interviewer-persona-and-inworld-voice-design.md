# Interviewer Persona & Inworld Voice — Design Spec

**Date:** 2026-06-18
**Status:** Approved (brainstorm) — pending user review of drafted examples + Weave facts
**Branch:** `prakul-script-extraction`
**Builds on:** `2026-06-18-realtime-interviewer-redesign-design.md` (the transcript-only realtime
interviewer; this spec adds production-grade persona/content + an Australian Inworld voice).

## Problem / goal

The redesigned realtime interviewer works structurally (transcript-only, no inline scoring, hard
coverage backstop) but is not yet "join the room and it works flawlessly." This spec closes that gap on
two axes: **(A) persona & content** — what the AI says and how human it feels — and **(B) voice** — an
Australian voice via Inworld instead of OpenAI's stock voices. Acceptance bar (user): join the interview
room and the full scripted interview runs flawlessly, as intended.

## Decomposition (two plans, sequenced)

- **Plan A — Interviewer persona & content.** Rubric + `plan_builder` + guardrail/monitor. Works on the
  *current* OpenAI realtime path; ship + test first.
- **Plan B — Inworld voice integration.** Spike-first; swaps the voice provider under Plan A.

Order: A lands and is testable on the current path; B1 (spike) runs in parallel (needs only the Inworld
key, already stored); B2 (production adapter) swaps the voice in. Final state → join room, Jarrah runs
the full interview.

---

## Plan A — Interviewer persona & content

All changes are content/instruction-level in `rubric/pilot-v1.yaml`,
`agent/src/agent/controller/realtime/plan_builder.py`, and
`agent/src/agent/controller/realtime/guardrail_monitor.py`. No `InterviewJobContext` change (candidate
name is deferred — see Open items).

### A1. Intro / AI disclosure
Update `opener.introduction` in the rubric to disclose the AI nature:
> "Hi there — I'm Prakul, an AI modeled after Prakul, an engineer here at Weave. I'll be running your
> interview today."

Keep the existing icebreaker (`small_talk_prompts`: "Where are you calling in from?", "How's the weather
over there?"). No candidate name yet.

### A2. Surface the (currently unused) acknowledgment phrases
`rubric.style.acknowledgments` is defined ("Got it. Got it. Got it.", "Awesome. Awesome. Awesome.",
"Okay. Cool. Cool.", 8 variants) + `thinking_fillers` ("Take your time.", "No rush.") but is **never used**
on the realtime path. Surface it into the instructions via `plan_builder`: a short style block instructing
the model to use brief, natural acknowledgments between answers before it probes or advances, drawing on
that pool, and to vary them. The realtime model speaks them as part of its turn — no mechanical injection,
no added latency. (Instant "mm-hm while you think" responsiveness is Plan B's back-channel, not this.)

### A3. Example answers for Q1 & Q3 (drafted; user to approve/edit)
Q2 & Q4 already carry worked examples in `when_stuck` (visa-forgery story, Napoleon-wine story). Q1 & Q3
only have decomposition nudges. Add worked examples to their `when_stuck` lists — exactly how Q2/Q4
already embed their examples there (no schema change; `plan_builder` already renders `when_stuck` as
"if they stall, nudge: …"). Match the Q2/Q4 pattern — concrete, slightly-extreme, "it could be anything
at that level." **Drafts for review:**

- **Q1 (problem_solving):** "I'll give you a sense of what I mean. Someone I talked to needed to match
  millions of records in real time — the obvious move was a bigger, faster database. Instead they noticed
  almost all the lookups hit the same few thousand keys, so they front-ran the whole thing with a tiny
  in-memory cache they rebuilt every few minutes and basically sidestepped the hard part entirely. So it's
  less about the textbook-correct answer and more about the clever, roundabout way you got there."
- **Q3 (competitiveness):** "To give you a sense — someone told me they were so into competitive Smash
  Bros in college they'd practice six, seven hours a day, skip classes for tournaments, and it genuinely
  tanked their GPA for a couple semesters. Another person climbed through finger injuries a doctor warned
  would do permanent damage. That level — where winning mattered enough it actually cost you something."

### A4. Weave-facts allow-list (user-supplied facts)
A new instruction block of facts the AI MAY state when asked; anything not here → "the team will follow
up." Verbatim from the user:
- **Product:** "Weave uses AI to understand and quantify the work software engineers do — how much
  they're getting done, how good it is, and how well they're using AI."
- **Team:** ~15 people, ~10 engineers; started with startups/SMBs, transitioning to enterprise; growing
  fast, which is why they're hiring.
- **Comp (relaxed — see A5):** "As a startup we're very open to negotiation; the job posting reflects
  what engineers are paid right now. If you have specific questions, reach out to Andrew." No specific
  numbers or equity.
- **Start dates (relaxed):** "We're flexible and will work around your schedule, with Andrew and Adam."
- **Process / next steps:** keep the rubric's existing closer (take-home → two technical interviews with
  Andrew the CTO → work trial → "we'll get back to you by tomorrow").
- **Location / work model:** 5 days/week in person in SF (already in the logistics question).

### A5. Guardrail + monitor alignment (comp/start-date relaxation)
The current `_GUARDRAILS` hard-blocks comp and start dates; the user now permits the sanctioned A4
answers. Rewrite `_GUARDRAILS` so:
- **Comp:** instead of "never discuss," give the A4 comp line and defer specifics to Andrew. Still
  hard-blocked: specific salary numbers, equity figures.
- **Start dates:** give the A4 flexible line.
- **Still hard-blocked (unchanged):** anything about scores, rubrics, or how candidates are evaluated
  (the user was explicit: nothing remotely internal to scoring); protected-class topics; commitments/
  promises on Weave's behalf; fabricating any fact not in the allow-list.
- **`guardrail_monitor.py`:** update the Haiku classifier system prompt so the sanctioned comp/start-date
  language is NOT classified as a `fabrication`/`commitment`/off-script violation (today it would fire a
  correction over allowed comp talk). The classifier must stay strict on: scoring leaks, specific comp
  numbers/equity, protected topics, fabricated company facts.

### A6. Closing
Keep the rubric `closer` (it already has the two logistics questions + next-steps + "back by tomorrow").
Ensure it ends warmly (a "thanks so much for your time — bye!" tail). Minimal change.

---

## Plan B — Inworld voice integration

Reference: [[inworld-voice-decision]] memory + https://docs.inworld.ai/realtime/usage/using-realtime-models.

### Decided parameters
- Provider: **Inworld Realtime** (OpenAI-Realtime-protocol-compatible cascade).
- Brain (LLM): **`anthropic/claude-haiku-4-5`** (Inworld routes the reasoning LLM).
- Voice: **`Jarrah`** (stock Inworld Australian male), `audio.output.model: "inworld-tts-2"`,
  `language: "en-AU"`.
- STT: `audio.input.transcription.model: "inworld/inworld-stt-1"`.
- Tools: our four control tools (`advance_question` / `request_probe` / `flag_off_script` /
  `close_interview`) via `session.tools`.
- `output_modalities: ["audio","text"]`.

### Architecture seam (already in place)
The realtime path talks to the `RealtimeSession` protocol (`agent/src/agent/voice/realtime/interface.py`)
with swappable adapters (`livekit_adapter`, `openai_ws_adapter`). Inworld becomes a **new adapter
implementing that same protocol** — runner / ControlBus / coverage / guardrail are unchanged. This is the
payoff of the redesign: the voice provider is a swappable edge.

### B1 — Connectivity spike (de-risk first)
Prove Inworld realtime end-to-end OFF the LiveKit room, reusing the raw-WS adapter pattern:
- Session-id pre-flight (HTTP) → WS connect with `key=<session-id>` (Inworld does NOT accept OpenAI
  Bearer-header auth on the realtime WS — confirmed integration risk).
- `session.update` with Claude-Haiku brain + Jarrah voice + instructions + the four tools.
- Drive a scripted candidate turn; confirm: (a) verbatim question fidelity, (b) the Australian voice
  renders, (c) a tool-call round-trip (`request_probe`/`advance_question`) works through Inworld's
  function-calling (`response.function_call_arguments.done`).
- Output: a go/no-go on the protocol + voice + tools before building the production bridge.

### B2 — Production adapter
`InworldRealtimeSession` implementing `RealtimeSession`, bridging the **LiveKit room** audio ↔ Inworld
realtime WS, wired into `entrypoint.py` behind the protocol. Retire OpenAI `gpt-realtime` as the default
realtime backend. This is the real integration work; B1 must pass first.

### Barge-in / turn-taking
Configure `turn_detection: semantic_vad` with interrupt-on-speech so the candidate talking stops the AI
mid-utterance (explicitly set, not left to provider defaults).

### Latency feel
Inworld **back-channel** (instant "mm-hm" while the candidate is still talking) + **responsiveness**
fillers (a short "let me think" while Claude warms), via `providerData`. This is what delivers the
"never an awkward >1s wait" goal on top of A2's surfaced acknowledgments. TTS-2 TTFB ≈ 200ms; end-to-end
voice-to-voice targets the normal ~300–600ms band, masked by back-channel.

---

## Testing

- **Plan A:** unit-test the new instruction rendering (intro disclosure present; acknowledgments style
  block present; Q1/Q3 examples present; allow-list facts present; guardrail block reflects the relaxed
  comp/start-date policy). Update `guardrail_monitor` tests so sanctioned comp/start-date language is NOT
  flagged while scoring/specific-comp/protected still are.
- **Plan B1:** the spike is a manual/scripted run (token-billed Inworld call, allowed autonomous — no
  room, no candidate); assert verbatim fidelity + tool round-trip + audio output exists.
- **Plan B2:** the LiveKit-room bridge is `pragma: no cover` vendor I/O; verified at the manual-gate room
  smoke test.
- **End-to-end acceptance (manual-gate):** join the room → Jarrah runs the full interview (intro →
  questions w/ probes + examples → candidate-Q handling → 2 logistics Qs → close), barge-in works, no
  fabrication, transcript persisted + graded by the backend.

## Manual-gate operations (halt the autonomous run)
- Deploy / flip the production default to the Inworld realtime path.
- Live LiveKit room smoke test (incl. specifically probing candidate-pause/barge-in behavior).
- Running an interview with a real candidate.

## Open items / deferred
- **Candidate name personalization** — deferred by the user ("no name for now, just a candidate; I'll add
  later"). When added: `candidate_name` field on `InterviewJobContext` + platform passes it in room
  metadata + inject into the opener.
- **Q1/Q3 example drafts** (A3) — user reviews/edits the drafted text in this spec before it lands in the
  rubric.
- **The deferred silence/reprompt→advance hard control** (from the prior redesign spec) remains a separate
  follow-up; the manual-gate smoke test should probe candidate-pause behavior.

## Non-goals
- Re-introducing live scoring (the redesign's invariant holds).
- Voice cloning (stock Jarrah is sufficient; no biometric-consent burden).
- Changing the backend grader or rubric scoring categories.
- Candidate-name plumbing (deferred).
