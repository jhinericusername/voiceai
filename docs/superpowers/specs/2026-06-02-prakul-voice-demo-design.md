# Prakul Voice Demo — Design Spec

**Date**: 2026-06-02
**Author**: pmishra (with Claude)
**Budget**: 2 hours, demo-bound
**Status**: Approved for implementation

## Goal

A working voice interviewer that sounds like Prakul, runs a polished script, and runs end-to-end through the `platform/` flow. Shippable as a v1 demo.

## Scope (v1)

- **Voice fidelity**: Cartesia Instant Voice Clone from a single 30-second audio sample extracted from one S3 video. Not Professional clone (would take too long).
- **Script fidelity**: Existing `rubric/pilot-v1.yaml` questions rewritten by hand to match Prakul's cadence, plus a warm opener. Probes still use the current LLM probe generator unchanged.
- **Flow**: `platform/` Next.js app, real candidate invite flow (recruiter creates interview → invite URL → consent/preflight/live).

## Non-goals (explicitly out)

- Swapping voice agent implementations (`livekit_session.py` vs `livekit_agent.py`). The existing `livekit_agent.py` is wired and works; leave it.
- Cartesia Professional voice clone.
- Transcribing the rest of the 20+ video corpus.
- Fixing `backend/test/token.test.ts` (unit test, irrelevant for demo runtime).
- Restoring origin's `CartesiaTTS` wrapper.
- Consolidating `room/` and `platform/`.
- Probe behavior changes.

## Touch list

| File | Change | Lines |
|---|---|---|
| `agent/src/agent/voice/session.py` | Pass `voice=os.environ["CARTESIA_VOICE_ID"]` to the `cartesia.TTS(...)` constructor | ~3 |
| `rubric/pilot-v1.yaml` | Rewrite `verbatim_text` per question; add an opener question; preserve all 4 categories and rubric structure | ~30 edits |
| `.env` (local, untracked) | Add `CARTESIA_VOICE_ID=<id from Cartesia dashboard>` | 1 |
| `.env.example` | Document `CARTESIA_VOICE_ID` (placeholder, no real ID) | 1 |
| `agent/Dockerfile` | Add `CARTESIA_VOICE_ID` to env passthrough if not auto-inherited | 1 (verify) |
| `scripts/extract_voice_sample.sh` (new) | ffmpeg one-liner: pull 30s of clean speech from one S3 video to a local WAV | ~10 |

## Sequence (2 hours)

1. **Voice clone (~30 min)**
   - Run `scripts/extract_voice_sample.sh <s3-url> <start-sec>` → produces `voice-sample.wav`
   - Manually upload to Cartesia dashboard → Instant Voice Clone
   - Copy voice ID into `.env`

2. **Script polish (~45 min)**
   - Listen to 2-3 videos for cadence (skim, not transcribe)
   - Edit `rubric/pilot-v1.yaml`:
     - Add `q0` opener (warm, brief — e.g. "Thanks for taking the time. To start, can you walk me through what you're working on right now?")
     - Soften each existing `verbatim_text` to sound less clinical
     - Keep `rubric_categories`, `target_evidence`, `max_probes`, `soft_budget_seconds`, `hard_stop_behavior` untouched
   - Smoke-test by reading aloud

3. **Wire & verify (~20 min)**
   - Apply 3-line change in `session.py`
   - Confirm platform/ env: `WORKOS_*`, `PUDDLE_BACKEND_INTERNAL_TOKEN`, `LIVEKIT_*`, `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL`
   - Boot: `pnpm --filter backend dev`, `cd agent && uv run python -m agent.worker`, `pnpm --filter platform dev`

4. **End-to-end test & iterate (~45 min)**
   - Sign in to platform → dashboard → create interview → open invite URL → consent → preflight → live
   - Listen. If voice sounds robotic: pick a different 30s sample and re-clone.
   - If script feels stilted: tweak `verbatim_text` lines, restart worker only (no rebuild).
   - Stretch: add `_experimental_controls.speed: "slow"` to the opener utterance via Cartesia per-call params.

## Risks & fallbacks

| Risk | Fallback |
|---|---|
| Instant clone sounds robotic | Try a different 30s sample with more vocal range; if still bad, fall back to a stock Cartesia voice closest to Prakul's range |
| `platform/` env not configured | 30-min budget to wire WorkOS dev creds; if blocked, fall back to `room/` dev backdoor (~20 min adapt to invite flow) |
| Cartesia plan doesn't allow voice cloning | Use stock Cartesia voice + still polish script — partial demo |
| Agent worker crashes on `CARTESIA_VOICE_ID` missing | Default to current behavior (omit `voice=` kwarg) if env var unset — graceful degradation |

## Acceptance criteria

- [ ] Recruiter can sign into platform, create an interview, get an invite URL
- [ ] Candidate opens invite URL, goes through consent/preflight, joins the room
- [ ] Agent speaks the opener within 5 seconds of candidate joining
- [ ] Agent's voice is recognizably Prakul (the user's judgment in checkpoint review)
- [ ] Agent walks through at least 3 of the 4 rubric questions in sequence with appropriate probes
- [ ] Interview ends gracefully (no crash, agent says a closing line)
- [ ] User has run through it end-to-end at least twice and tweaked the script at least once

## Open questions (deferred past v1)

- Cartesia Professional voice clone path — needs the curated corpus work
- Probe LLM prompting with Prakul transcripts as few-shot — depends on transcribing the corpus first
- Mannerism extraction (filler, transitions, pushback patterns) — same dependency
- Voice-agent consolidation (`livekit_session.py` vs `livekit_agent.py`) — separate refactor
