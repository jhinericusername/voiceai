# Voice architecture — realtime / speech-to-speech directions

**Status:** exploration notes for future sessions (not approved work). Captured
2026-06-16 from a conversation about moving off the cascaded pipeline.

## Where we are today

Cascaded pipeline in a LiveKit Agents worker:
**Deepgram STT → Anthropic scorer/probe LLM → Cartesia TTS**, driven by
`InterviewRunner` (`agent/src/agent/controller/interview.py`). Defining traits:

- The agent **speaks only verbatim / pre-approved rubric text** (questions,
  transitions, acknowledgments). It does not improvise.
- Evaluation is **deterministic and structured**: a scorer LLM reads the
  transcript and emits per-category scores + confidence; a probe loop decides
  follow-ups. Score checkpoints + transcript turns + agent events are emitted as
  auditable artifacts.
- We just spent two sessions removing the post-answer latency by moving scoring
  off the speech path (ack-while-scoring, async probe).

These traits exist on purpose: it's a **hiring screen**, so consistency,
fairness, script fidelity, and auditability are load-bearing (legal
defensibility, candidate-to-candidate comparability).

## The two directions to try (separately, future sessions)

### 1. Speech-to-speech (S2S) model

A single multimodal model takes candidate audio in and produces agent audio out
— no intermediate STT/TTS. Candidates in 2026: **OpenAI `gpt-realtime-2`**
(GPT-5-class reasoning, sub-300ms), **Gemini Live native-audio**. Both are
first-party LiveKit plugins (`RealtimeModel`) — swap-in, same worker shape.

- **Wins:** lowest latency, natural prosody, native interruption/barge-in and
  backchanneling ("mm-hm"), no TTS "wonkiness" to tune, no cascade seams.
- **Costs:** you give up **verbatim control** (the model generates its own
  words/audio), the **deterministic scoring inputs** (no clean turn boundaries
  for the scorer), and **auditability** (harder to prove what was asked/why).
  Tool-calling reliability is approaching cascaded parity in 2026 but isn't
  there for high-stakes flows.

### 2. Realtime + prompt-engineering + guardrails (OpenAI Realtime)

Same `RealtimeModel` path, OpenAI Realtime specifically. **Note:** you can't
*fine-tune* it — OpenAI deprecated the self-serve fine-tuning API (May 2026) and
realtime models aren't fine-tunable. So this is **system-prompt + steering +
guardrails**, which is what we'd want anyway for an interview:

- Pin the question script in the instructions; constrain the model to ask the
  approved questions in order and not invent new graded content.
- Guardrails: no legal/▒protected-class topics, no scoring leakage to the
  candidate, no improvised commitments, refusal/redirect on off-script asks.
- Real-time fits a conversation — the user's core intuition. The risk is the
  same as (1): keeping it on-script and gradable.

(1) and (2) are the same axis; (2) is a specific S2S model with a control story.

## The real tension (read before building either)

**S2S trades determinism + verbatim fidelity + structured scoring +
auditability for naturalness + latency + interruption handling.** For a hiring
tool, the first set is not optional. Don't adopt S2S in a way that makes two
candidates get materially different questions or makes scoring unexplainable.

## Recommended shape: hybrid, not either/or

Keep evaluation deterministic; use realtime only for *delivery/conversation*.

- **Realtime for conversation, scoring out-of-band.** Let a RealtimeModel run
  the spoken turn-taking, but (a) constrain its content to the verbatim script,
  and (b) keep the rubric scorer reading the transcript **off the realtime
  loop** — exactly the async pattern we already built. The realtime model never
  scores; it just talks.
- **Tier by stakes.** Full S2S freedom for the low-stakes parts (greeting, small
  talk, acks, "any questions for me?"); strict verbatim + clean turn capture for
  the graded questions. Best naturalness-where-safe, control-where-it-counts.
- **Or: S2S as a naturalness layer only** — model speaks our exact text with
  better prosody/barge-in, no content freedom. Smallest behavior change.

## To verify when those sessions start

- OpenAI Realtime: can instructions reliably hold a multi-question script in
  order across a 15-min call? Barge-in behavior mid-question? Cost per session
  (token-billed audio) vs current cascade.
- Gemini Live native-audio as the S2S option (often cited lower-latency/more
  natural than OpenAI Realtime) — bench both.
- How to get clean, scorable turn boundaries + transcripts out of an S2S model
  for the rubric scorer (does the plugin surface input/output transcripts?).
- Guardrail enforcement: can we hard-block off-script/▒protected-topic drift, and
  prove it for compliance?
- Interleave with the latency work already shipped — S2S would make most of it
  moot for its parts, but the scoring-off-the-path pattern still applies.

## Pointers

- Current controller: `agent/src/agent/controller/interview.py`
- Cascade wiring: `agent/src/agent/worker/entrypoint.py`,
  `agent/src/agent/voice/{stt,tts,livekit_session}.py`
- Latency/clone handoff: `docs/handoff/2026-06-11-voice-latency-and-cloning.md`
- LiveKit realtime plugins: `livekit.plugins.openai.realtime`,
  `livekit.plugins.google` (Gemini Live)
