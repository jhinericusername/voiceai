# Prakul screen-call reference recording — 2026-06-15

Summary of `Weave 15min Screen Q&A (8.2min).m4a`, a solo recording of Prakul
delivering the full Weave screening script. Structured companion data:
[`2026-06-15-prakul-screen-reference.json`](./2026-06-15-prakul-screen-reference.json).

## What this recording is

- **8m18s, mono, interviewer-only.** Deepgram nova-3 + diarization detected a
  single speaker (~4.8 min of speech). Every utterance is Prakul's side of a
  screen call — greeting, questions, probe scaffolding, examples, logistics,
  closer. The candidate's answers fall in the silent gaps and were **not**
  recorded, so there is **no candidate voice or PII** here.
- It reads as a reference/scripting take: the self-intro appears ~4 times and a
  later block re-delivers the questions in tighter form, suggesting re-records.
- Raw Deepgram JSON + the diarized transcript live in gitignored
  `artifacts/transcripts/screen_qa_2026-06-15.*`. Voice-clone clips (clean
  Prakul spans + a 68s concatenated reference) live in gitignored
  `artifacts/voice-samples/screen_2026-06-15/`.

## Script structure (as delivered)

1. **Greeting** — "Hey, how are you? / Where are you calling in from? / How's the weather over there?"
2. **Intro** — "My name is Prakul. I'm an engineer here at Weave… can you tell me a bit about yourself?"
3. **Warm-up** — "What do you do for fun outside of work?"
4. **Technical** — "a time you solved a technical problem with a clever, novel, or elegant solution," then the *junior-dev framing* probe (explain the problem, the obvious solution, and your clever solution).
5. **YC hacking** — gated by "Have you ever applied to YC?", then "a time you hacked a non-computer system to your advantage," with two concrete scaffolding examples (forged visa-extension signature; concert-lot flyering) and a re-ask.
6. **Competitiveness** — "an area of your life where you are extremely competitive," probed to "the most extreme thing you have done to win," with scaffolding (sports/video games/past/current).
7. **Niche expertise** — "a niche or obscure non-technical topic… you're in the top 1%."
8. **Logistics** — 5-days-in-person-SF, then visa sponsorship.
9. **Candidate Q&A** — "Do you have any questions for me?"
10. **Closer** — review with the CEO/CTO, decision by tomorrow morning, warm sign-off.
11. **Weave pitch** (delivered separately) — one-liner on what Weave does.

## Why it matters

- **Voice clone.** This is clean, expressive, solo Prakul audio (~4.8 min total)
  — well above the 2–5 min target. The extracted 68s reference is ready to feed
  a Cartesia or Inworld clone (see the TTS provider note in the latency/cloning
  handoff).
- **Rubric refresh.** The 425–468s block delivers newer, probe-forward question
  phrasings (e.g. "a genuinely hard problem where the final solution was not
  obvious… why wasn't the obvious approach good enough?") that differ from the
  current `rubric/pilot-v1.yaml` verbatims. Flagged in the JSON under
  `alternate_phrasings` as a candidate update.
