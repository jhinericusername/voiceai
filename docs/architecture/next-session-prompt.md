# Next-session kickoff prompt — realtime architecture (spike → build)

Paste the block below to start the fresh session. It carries the 2026-06-16/17
spike's settled findings forward so the new session spends its budget on the
design, not on re-proving verbatim fidelity.

---

Continue the voice-agent work — moving from spike to build: design and implement the
realtime / speech-to-speech interview architecture.

Read these first, in order:
- docs/architecture/2026-06-16-realtime-spike-findings.md  ← the spike that just ran; it
  answers the verbatim-fidelity question. Don't re-run or re-litigate it.
- docs/architecture/2026-06-16-realtime-s2s-directions.md  ← converged design + control mechanisms
- the voice-latency-cloning-handoff memory
- docs/interviews/2026-06-15-prakul-screen-reference.json  ← the script
- Current code: agent/src/agent/controller/interview.py, agent/src/agent/worker/entrypoint.py,
  agent/src/agent/voice/{stt,tts,livekit_session}.py

What the spike already settled (treat as established; don't redo):
- gpt-realtime, given the full script + guardrails in its instructions and left to run the
  interview autonomously, HOLDS the approved wording (verbatim / near-verbatim, EXACT on many
  graded questions) in BOTH text and audio. Verbatim drift is not the blocker we feared.
- It refuses comp / protected-class / scoring asks cleanly and returns to script (guardrails
  under direct pressure: strong).
- Two real residual risks: (1) COVERAGE — it skips/bundles questions and improvised its own
  closing instead of the scripted one; (2) a SUBTLE guardrail leak — it fabricated company
  facts ("the team is small pods, pair programming…") on an open question, which the
  in-instruction guardrails missed.

Goal: take the converged "app-orchestrated realtime, scoring off-loop" design to
implementation. The realtime model owns conversational flow from a full-script prompt; control
is out-of-band (NOT per-turn gating); a separate reasoning model grades the transcript
off-loop. Preserve existing investment — rubric, interview state machine, scorer, probe logic,
event-log artifacts all stay; rewrite primarily the I/O layer (LiveKitSessionVoiceAgent) and
re-cast InterviewRunner as plan-builder + coverage backstop + async steering injector rather
than a turn-by-turn driver.

Use the agentic build workflow: brainstorming skill first (resolve the questions below), then
writing-plans, then autonomous task-by-task execution → merge. One planning entry — don't run
a second planning pipeline.

Design questions for the brainstorm to resolve:
1. Control: how much rides on instructions vs a tool-call control bus
   (advance_question / request_probe(category) / flag_off_script). Keep the existing
   probe/advance decision logic authoritative.
2. Coverage backstop: how to guarantee every required question is asked (verbatim) before the
   model closes — the spike proved this is needed.
3. Guardrail monitor: a cheap output-transcript watcher for the subtle fabrication / off-script
   drift instructions miss, able to interrupt/correct.
4. Off-loop scorer wiring: confirm the LiveKit realtime plugin surfaces BOTH input (candidate)
   and output (agent) transcripts with clean turn boundaries; feed the existing rubric scorer
   async (the ack-while-scoring pattern already shipped).
5. Tiering by stakes: graded questions verbatim/re-grounded vs conversational glue free. Decide
   whether any question class needs the deterministic-TTS fork (spike suggests wording fidelity
   is good enough that we likely don't, but the most legally-sensitive items might).
6. Provider: gpt-realtime (spike-validated) as primary; decide whether to build
   provider-pluggable to also support Inworld Realtime (OpenAI-protocol drop-in, can route
   reasoning to Claude — strong control fit) and/or Gemini Live.
7. Auditability: how to prove what was asked and why (legal defensibility for a hiring screen)
   when the model owns the flow.

Fold the spike's open validation tasks in as early plan steps: (a) swap the fixed mock for an
ADAPTIVE LLM candidate to get clean coverage/ordering numbers; (b) a long (~15-min) session
drift test. The spike harness in tmp/realtime-spike/ (gitignored) is reusable — extend it.

Constraints:
- manual-gate (halt for approval): any deploy / ECS roll, DB schema migration, bulk writes to
  shared data, running with a real candidate, or reducing human oversight of scoring.
- Big experiments go in tmp/ first; don't touch production wiring until the plan says so.
- OPENAI_API_KEY is now in .env.
