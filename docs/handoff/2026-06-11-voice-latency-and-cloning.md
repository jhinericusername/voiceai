# Handoff — voice latency, voice quality, Prakul voice clone

**Date:** 2026-06-11. **Branch:** `prakul-script-extraction` (up to date with its remote; `origin/main` moved `8f0fe78..c3da23d` — merge main in before big changes).

## Mission (user's words, paraphrased)

Candidate feedback after the 2026-06-09 bugfix batch shipped:

1. **"Agent sounds very wonky — could we use 11labs or something out-of-box?"**
2. **"Latency is like 5–10 seconds after I give it a legit answer. Up to 20 seconds sometimes because it's processing everything in one go."**
3. **NEW: clone Prakul's voice** — user will supply audio from Prakul.

Operating instructions from the user:

- Run autonomously **until the agent runs flawlessly**. The platform works; the candidate experience must be flawless.
- **Pull first** (done 2026-06-11; pull again at session start).
- **Set up some version of testing** — a latency/quality harness, not just unit tests.
- **Any big/experimental changes go in a `tmp/` folder** first.
- Deploys remain **manual-gate** per `CLAUDE.md` — halt for approval before any ECS roll / release.

## Work item 1 — post-answer latency (5–20 s)

The symptom "processing everything in one go" strongly suggests the interview
controller runs its LLM work (scoring / probe generation, Anthropic calls)
**synchronously between the candidate's answer and the next spoken prompt**.
Nothing has been verified yet — first step is tracing the turn loop.

Leads, in priority order:

- `agent/src/agent/controller/interview.py` — trace what happens between
  `_listen()` returning and the next `session.say()`. If scoring/probe LLM calls
  sit on that path, move them off it: speak an acknowledgement + next question
  immediately, run scoring concurrently (asyncio task) or defer to finalization.
  Probe generation genuinely needs the answer — if a probe must come next,
  consider speaking a short bridge line while the probe LLM call runs.
- `agent/src/agent/voice/livekit_session.py` — `listen()` coalesces Deepgram
  finals with a 0.8 s drain window (`PUDDLE_TRANSCRIPT_COALESCE_SECONDS`);
  `build_agent_session` uses `min_endpointing_delay=0.5`, `max_endpointing_delay=3.0`.
  These add ≤ ~1.5 s — real but not the 5–20 s. Don't start here.
- **Readiness-timeout red herring:** the deployed agent waits up to 10 s
  (`PUDDLE_CANDIDATE_READY_TIMEOUT_SECONDS`) for a `ready` participant attribute
  the **not-yet-deployed** frontend never sends, then fails open. That delays the
  **opener only**, not per-answer turns — but testers may fold it into "slow".
  See Work item 4.
- LiveKit Cloud project is still pinned to **São Paulo** (~180 ms RTT from SF)
  — `docs/KNOWN_ISSUES.md` #3. Real but accounts for well under 1 s.

Add timing instrumentation (per-turn timestamps: answer-end → next-say-start,
broken into STT-final wait, LLM time, TTS first-byte) so the fix is measured,
not vibes. This instrumentation is the seed of the testing harness.

## Work item 2 — voice quality ("wonky")

Current TTS: Cartesia `sonic-3`, `speed=1.05`, `text_pacing=True`, voice from
`CARTESIA_VOICE_ID` (`agent/src/agent/voice/tts.py`). The `speed`+`text_pacing`
combo is the prime suspect for artifacts — first cheap experiment is reverting
to defaults (`speed` unset, no pacing) and A/B-ing.

Provider decision interacts with Work item 3 (cloning):

- **Cartesia (current):** key already in `.env`; supports instant voice cloning
  from short samples — cloned voice becomes a new `CARTESIA_VOICE_ID`. No new
  dependency, no secret changes, no infra change. **Recommended default.**
- **ElevenLabs:** no `ELEVENLABS_API_KEY` in `.env` — needs an account/key from
  the user, plus `livekit-plugins-elevenlabs` dep, plus a new Secrets Manager
  entry + task-def env for prod. Higher out-of-box quality reputation; instant
  voice cloning needs ~1–2 min of clean audio.

Build the A/B bench (tmp/ folder) so candidate-facing voice choices are heard,
not guessed: synthesize the same interview prompts through each candidate
config, write WAVs to `tmp/voice-bench/`, let the user listen and pick.

## Work item 3 — clone Prakul's voice

User is getting audio from Prakul. Audio ask (already relayed to user):
**2–5 minutes of clean, conversational solo speech** — quiet room, no
music/reverb/crosstalk, natural interviewer tone, WAV/FLAC preferred.

- Cartesia path: clone via Cartesia API/dashboard → new voice ID → set
  `CARTESIA_VOICE_ID` (env locally; Secrets Manager
  `/puddle-videoagent/providers/cartesia-api-key` is the key — the voice ID is
  plain env in the agent task def, see `infra/lib/infra-stack.ts`).
- ElevenLabs path: instant voice clone → voice ID → requires the full provider
  swap above.
- Cloning a real person's voice: confirm Prakul's consent is on record (user is
  sourcing the audio directly from him, so this is presumably fine — note it).

## Work item 4 — frontend (room app) deploy still unresolved (carryover)

The 2026-06-09 batch shipped the **agent half only**. The room app changes
(`ready` attribute signal + tap-to-enable-audio) are committed but **not
deployed**, so the agent burns its 10 s ready-timeout every interview.

- CDK `room-web` bucket `puddle-videoagent-room-web-851725544921-us-west-1` is
  **empty** — the deployed candidate UI is NOT served from it.
- Only CloudFront found: `d1haxbiha2mef4.cloudfront.net` →
  `react-cors-spa-j96n53xqc6.s3.us-east-1.amazonaws.com` (manually created?).
- Platform lives at `app.usepuddle.com`.
- **Open question for user:** what URL loads the actual call screen in a test
  interview? Until answered, either deploy nothing or lower
  `PUDDLE_CANDIDATE_READY_TIMEOUT_SECONDS` (agent task-def env) as a stopgap.

## Infra cheat sheet

- AWS account `851725544921`, region `us-west-1`, CDK stack
  `Puddle-VideoAgent-Infra`, cluster `puddle-videoagent-cluster`.
- Services: `puddle-videoagent-{backend,platform,agent}-service`.
- Agent image deployed: ECR `puddle-videoagent-agent:cbf4533-agent-bugfix`,
  task-def family `puddle-videoagent-agent` **rev 15**, cmd
  `python -m agent.worker start`, circuit-breaker rollback on.
- Build: `docker build -f agent/Dockerfile .` from repo root (ARM64).
- LiveKit Cloud project `puddle-interviews-0au0kkmo`
  (`wss://puddle-interviews-0au0kkmo.livekit.cloud`), API key prefix `APIyRc`,
  pinned to São Paulo (region move = manual dashboard step, KNOWN_ISSUES #3).
- Secrets Manager paths: `/puddle-videoagent/livekit/api-key`, `.../api-secret`,
  `/puddle-videoagent/providers/{anthropic,deepgram,cartesia}-api-key`.

## Verification

- Python: `cd agent && uv run pytest` (140 green as of 2026-06-11) and
  `uv run ruff check .`
- TS: `pnpm -r test` (room tests live under `room/test/` — vitest only collects
  `test/**/*.test.ts`, NOT `src/`).
- Local e2e loop: `docs/RUNBOOK.md` §6 "Run a test interview".
- `AgentSession` kwargs are flat (`vad=`, `turn_detection="vad"`,
  `min_endpointing_delay=`) — verified against installed SDK 1.5.11; don't
  trust docs that show a nested `turn_handling` dict.

## Suggested order

1. Pull + merge `origin/main` into the working branch.
2. Instrument + trace the turn loop; fix the latency architecture (biggest win).
3. Voice A/B bench in `tmp/`; pick Cartesia-tuned vs ElevenLabs with the user.
4. Clone Prakul's voice once audio arrives; wire voice ID.
5. Test harness made permanent (regression tests + latency budget assertions).
6. Manual-gate: agent image build + ECS roll (needs explicit user approval).
7. Resolve frontend deploy target with the user (kills the 10 s opener delay).
