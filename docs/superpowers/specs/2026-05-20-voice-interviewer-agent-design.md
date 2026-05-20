# Puddle Voice Interviewer Agent — Design Spec

**Date:** 2026-05-20
**Status:** Draft v2 — unifies the original spec with the cofounder's "Puddle Video Agent" doc
**Owner:** Puddle (CTO)

## Context

Puddle automates engineering hiring on two pillars: (1) a thorough, co-designed rubric — Puddle sits with hiring managers/CTOs per role to define the traits to assess, a 1–4 scoring scale, and an explicit "bar" for each category; (2) automating every interview so candidates get the right questions and are assessed consistently against that rubric.

This project builds **the first-party interview room and the AI interviewer agent** — the interview room was handed off from the cofounder, so it is now in scope here. The agent conducts a live, structured voice+video interview, probes intelligently, and scores the candidate against the rubric in real time. The cofounder continues to own the broader Puddle platform (company dashboards, candidate management, rubric authoring); this project integrates with it across a defined API boundary.

Today interviews are run manually. Puddle has a corpus of recorded, human-scored interviews for the pilot role — the calibration ground truth for the agent's scorer.

This is an empty repository. v1 is built from scratch.

## Goals (v1)

- A **first-party WebRTC interview room** on a managed media layer — Puddle owns the candidate experience, timing, recording, consent flow, and data model.
- Conduct a live, structured voice interview for **one pilot role**: verbatim base questions, adaptive probing.
- **Score-driven interview loop (the core IP).** After each answer, the agent assesses every in-play rubric category — provisional 1–4 score, confidence, supporting evidence, what is still missing. Low confidence on a category → probe deeper; confident with evidence → move on. The interview ends when every category is confidently scored, or the time cap forces a stop (uncertain categories then flagged).
- **Full multimodal.** Candidate video is captured, recorded, and processed for **integrity signals** (reading off-screen, multiple faces in frame, candidate absent) and a turn-taking hint. Video is **never** a scoring input.
- Produce a **structured assessment**: per category, a 1–4 score with evidence quotes, rationale, confidence, and integrity flags → delivered to a human reviewer.
- Validate the live scorer against the human-scored corpus before human oversight is ever reduced.
- Compliant by design: candidate disclosure + consent, recording with retention/deletion, human sign-off on every assessment, immutable audit log.

## Non-goals (v1)

- **No scoring on video or voice nonverbals.** Assessment is transcript-content only — what the candidate says, not how they look or sound. Legal requirement; nonverbal cues also carry near-zero predictive value.
- **No autonomous hiring decisions.** Every assessment is a human-reviewed recommendation. The system never auto-rejects or auto-advances a candidate. Computing the score and using it to *run the interview* is in v1; *acting on it without a human* is gated behind validation + bias audit + counsel.
- No multi-role / multi-rubric, no multi-language — one pilot role, English.
- No model fine-tuning — the corpus is used for evaluation/calibration and few-shot prompt examples only.
- No speech-to-speech model in v1 — cascaded voice; the voice I/O layer is swappable (TML-Interaction-Small or another realtime model slots in later).
- No photorealistic avatar — the agent is shown as a simple visual (waveform / portrait card). Avatar embodiment is a later phase.
- No Zoom/Meet integration — first-party room only; meeting-bot adapters are a later phase.

## Architecture

A first-party interview room on LiveKit, with a Python agent worker that joins each interview as a participant. The agent worker runs a **cascaded voice pipeline**, a **deterministic Interview Controller**, and a **live Rubric Scorer**. The controller is the spine; the scorer is the decision engine; LLM intelligence is bounded inside both.

```
   ┌──────────────────────────────────────────────────────────────┐
   │ Interview Room (TypeScript web app)                           │
   │ landing · identity check · consent · device/network preflight │
   │ waiting room · interview timer · in-call UI · completion page  │
   └───────────────────────────┬──────────────────────────────────┘
                                │ WebRTC (audio + video)
   ┌────────────────────────────▼─────────────────────────────────┐
   │ LiveKit  —  SFU media room  +  Egress (composite + per-track  │
   │ recording → object storage)                                   │
   └──────────┬───────────────────────────────────┬───────────────┘
              │ audio                             │ video frames
   ┌──────────▼───────────────────────────────────▼───────────────┐
   │ Interview Agent Worker (Python · LiveKit Agents) — 1/interview │
   │                                                                │
   │  Voice I/O (cascaded, swappable)   Video Perception (parallel) │
   │   STT → turn detection → TTS        frame sample → VLM         │
   │          │         ▲                      │                   │
   │  transcript        │ approved utterance    │ integrity + turn  │
   │          ▼         │                       │ events            │
   │  ┌───────────────────────────┐             │                   │
   │  │ Interview Controller       │◄────────────┘                   │
   │  │ deterministic state machine·timing·event log·reason codes │ │
   │  └──────┬─────────────────▲──┘                                 │
   │         │ answer          │ directive (ask / probe / advance)  │
   │  ┌──────▼─────────────────┴──┐   ┌─────────────────────────┐   │
   │  │ Live Rubric Scorer (IP)    │──▶│ Probe Generator         │   │
   │  │ per-category 1-4 + conf +  │   │ targeted follow-up,     │   │
   │  │ evidence + missing gaps    │   │ controller-approved     │   │
   │  └────────────────────────────┘   └─────────────────────────┘   │
   └───────────────────────────┬────────────────────────────────────┘
                                │ assessment · transcript · events · artifacts
   ┌────────────────────────────▼─────────────────────────────────┐
   │ Backend (TS): Scheduler/API · Orchestrator · Finalization     │
   │ Rubric & Assessment Store · Object Storage · Audit Log         │
   └──────────┬──────────────────────────────────┬────────────────┘
              │                                  │
   ┌──────────▼───────────┐         ┌────────────▼────────────────┐
   │ Review App (TS)       │         │ Eval & Calibration Harness   │
   │ VOD + transcript +    │         │ replays human-scored corpus  │
   │ scores → human sign-off│        │ through the Scorer offline   │
   └──────────────────────┘         └─────────────────────────────┘
```

**The three reasoning roles inside the worker:**
- **Voice I/O (cascaded, swappable).** Streaming STT, semantic turn detection, TTS. Speaks *only* controller-approved text. The swap point: a future implementation wraps a speech-to-speech model behind the same interface.
- **Interview Controller — the spine.** A deterministic state machine. Owns interview state, question order, server-enforced timing, every spoken utterance, and the event log. It does not reason about candidate quality — it executes.
- **Live Rubric Scorer — the decision engine (the IP).** After each answer, a text LLM scores every in-play rubric category: provisional 1–4, confidence, evidence quotes, missing/ambiguous elements. Its confidence output is what tells the controller to probe or advance. (This is the "background model" in Thinking Machines terms.)

A separate **Probe Generator** drafts targeted follow-ups when the scorer reports low confidence; the controller approves the final wording. The **Video Perception Pipeline** runs in parallel, decoupled, emitting non-scoring integrity and turn-hint events.

## Components

Each component: one clear purpose, a defined interface, listed dependencies.

### 1. Interview Room (web)
- **Purpose:** the candidate-facing first-party room.
- **Interface:** TypeScript web app. Candidate landing page; light identity check (name/email/token); consent + AI-disclosure capture *before* mic/camera activation; device + network preflight; waiting room until scheduled time; in-call UI (agent as a simple visual, candidate self-view, interview timer); repair controls (restart session, switch audio device, contact support); post-interview completion page. Media via the LiveKit client SDK.
- **Depends on:** LiveKit client SDK, Scheduler/API.

### 2. Media & Recording
- **Purpose:** carry audio+video; record the session reliably.
- **Interface:** LiveKit SFU room per interview. LiveKit Egress records a composite plus separate candidate/agent audio and candidate video tracks to object storage. Recording finalization is a first-class workflow with retries and status — never assumed to succeed.
- **Depends on:** LiveKit (Cloud or self-hosted), object storage.

### 3. Voice I/O (cascaded, swappable)
- **Purpose:** hear the candidate and speak — under full controller control.
- **Interface:** a `VoiceAgent` abstraction — `speak(text, mode)`, `listen() → transcript + turn events`, `interrupt()`, `set_mode(scripted | clarifying | repair | closing)`. v1 implementation: streaming STT + semantic turn detection + TTS. **Speaks only text the controller supplies.** Future implementation: an S2S model behind the same interface.
- **Depends on:** streaming STT, a semantic turn-detection model, TTS, LiveKit Agents.

### 4. Interview Controller
- **Purpose:** deterministically run the interview.
- **Interface:** a state machine (see *State machine* below). Owns: question order, server-enforced timing budgets, the probe/advance decision (acting on the Scorer's confidence), every utterance, and an event written per utterance with a reason code. Approves or rejects Probe Generator output. It is plain code, not an LLM.
- **Depends on:** Rubric & Assessment Store, Voice I/O, Scorer, Probe Generator.

### 5. Live Rubric Scorer (the IP)
- **Purpose:** assess the candidate against the rubric, continuously, and tell the controller when evidence is sufficient.
- **Interface:** a text LLM. Input: rubric, running transcript, current question + its target categories, accumulated evidence. Output, per in-play category: `{ provisional_score: 1-4, confidence, evidence_quotes[], missing_or_ambiguous[] }`. A lightweight pre-pass runs *during* the answer so a probe is ready the moment the candidate stops (hides probe latency); the full scorer runs at turn end. Also runnable standalone against transcripts (see Eval Harness) — the *same* component, run two ways.
- **Depends on:** the Scorer LLM, Rubric & Assessment Store.

### 6. Probe Generator
- **Purpose:** when the Scorer reports low confidence, draft a follow-up that targets the specific missing evidence.
- **Interface:** a text LLM. Input: the category, its `missing_or_ambiguous` elements, transcript context, and per-question probe budget. Output: a candidate follow-up question. The controller approves the final wording; probes are elicitation-focused, never coaching, and capped per question and per category.
- **Depends on:** the Probe Generator LLM, Interview Controller.

### 7. Video Perception Pipeline
- **Purpose:** non-scoring side signals.
- **Interface:** decoupled, parallel pipeline. Samples candidate video frames (~1–2 fps) → VLM. Emits **integrity signals** (gaze/reading-off-screen, multiple faces in frame, candidate absent) and a **turn hint** ("appears to still be formulating"). Integrity signals are logged and flagged for human review — never an auto-reject, never fed to the Scorer. Disclosed to candidates in consent.
- **Depends on:** a VLM, LiveKit Agents.

### 8. Rubric & Assessment Store
- **Purpose:** hold the rubric, the question plan, and assessment outputs.
- **Interface:** rubric as structured config — categories, per-category 1–4 bar anchors, the bare-minimum rule, and the ordered question plan (see *Pilot role*). Assessment output per session: per-category final score + evidence + rationale + confidence, the `meets_bare_minimum` determination, and integrity flags.
- **Depends on:** a persistence layer (aligned with the cofounder's platform — decided in planning).

### 9. Backend Services
- **Purpose:** schedule, orchestrate, finalize.
- **Interface:** TypeScript. Scheduler/API (creates sessions, provisions a LiveKit room, dispatches an agent worker; pre-warms workers ahead of scheduled start times); Interview Orchestrator (session lifecycle); Finalization worker (assembles transcript + artifacts after the call). Integrates with the cofounder's platform over a documented REST API.
- **Depends on:** LiveKit server API, object storage, Rubric & Assessment Store.

### 10. Review App
- **Purpose:** human sign-off.
- **Interface:** internal TypeScript web app. Per session: VOD playback, question-aligned transcript, per-category score + evidence + confidence, integrity flags, and the event log. The reviewer edits/approves; sign-off is recorded in the audit log.
- **Depends on:** Assessment Store, object storage (signed URLs), audit log.

### 11. Eval & Calibration Harness
- **Purpose:** prove the Scorer agrees with human interviewers before live trust is extended.
- **Interface:** replays the human-scored corpus through the Scorer (standalone mode) and reports agreement vs. human scores — exact-match rate, within-1 rate, per-category correlation/κ — against an explicit pass threshold. Also mines the corpus for few-shot probe/scoring-anchor examples fed into the Scorer and Probe Generator prompts.
- **Depends on:** the Scorer, the corpus, the Rubric Store.

### 12. Compliance & Governance
- **Purpose:** make the system lawful to operate as a hiring tool.
- **Interface:** consent + AI-disclosure capture before recording; retention with deletion-on-request; **human sign-off required on every assessment**; an immutable audit log capturing script version, model versions, every utterance + reason code, and every score + evidence. No facial or emotion analysis anywhere.
- **Depends on:** persistence layer, audit logging.

## The interview model

**Rubric.** A set of categories (the rubric sheet calls them "dimensions"), each scored 1–4 against explicit bar anchors, plus a **bare-minimum rule** that rolls the per-category scores up into a meets-bar / below-bar recommendation. The rubric — categories, anchors, bare-minimum rule, and question plan — is structured config; see *Pilot role* below for the concrete v1 instance.

**Question plan.** An ordered set of verbatim base questions. Every candidate gets the same base questions — consistency and fairness. Each question is mapped to the rubric categories it is meant to elicit evidence for. Adaptive probing happens *between* base questions, driven by the Scorer.

**Question schema:**
```json
{
  "script_version": "pilot-v1",
  "question_id": "q1",
  "verbatim_text": "Can you tell me about a technically complex problem you solved with a clever or hacky solution?",
  "rubric_categories": ["problem_solving"],
  "target_evidence": ["the problem and why it was hard", "the solution and why it was clever or elegant", "the impact and level of recognition"],
  "max_probes": 2,
  "soft_budget_seconds": 180,
  "hard_stop_behavior": "acknowledge_and_move_on"
}
```

**The score-driven loop.** For the current base question, after each candidate answer:
1. The Scorer assesses each `rubric_category` the question targets.
2. For each targeted category: if `confidence` is below threshold **and** probes remain **and** time remains → the Probe Generator drafts a follow-up at the `missing_or_ambiguous` elements; the controller approves and asks it.
3. When every targeted category is at or above the confidence threshold (or probes/time are exhausted) → advance to the next base question.
4. After the last base question → closing. Any category still below threshold is recorded as a low-confidence score and flagged for the reviewer.

**Outcome.** After closing, the per-category scores are rolled up through the rubric's bare-minimum rule into a meets-bar / below-bar recommendation. The loop probes only to reach a *confident* score on each category — it never probes harder to push a candidate over a threshold. The bare-minimum is computed from honest scores; the result is a recommendation a human reviewer signs off on.

**Timing.** A **server-enforced total time cap** for the interview, with soft per-question budgets. Probing depth is **adaptive within the cap** — the controller spends remaining time on whichever categories are still low-confidence. Near a hard stop, the agent uses a scripted humane boundary line ("Thank you — I'm going to move on so we cover everything"). The model is given the clock; the server enforces it.

**Agent behavior contract (non-negotiable):**
1. Base questions are spoken verbatim from the controller — never generated or paraphrased by an LLM.
2. The agent adds no extra criteria, examples, or hints beyond the script.
3. Probes are capped per question and per category.
4. Probes are elicitation-focused, never coaching.
5. The server enforces timing.
6. Every agent utterance is logged with a reason code.
7. The candidate can interrupt at any time.
8. The agent recovers gracefully from silence, noise, and confusion.
9. The agent never states scores or assessments aloud.
10. The agent never explains internal rubric details.

**Reason codes** (per utterance, for review and debugging): `CONSENT`, `INTRO`, `SCRIPTED_QUESTION`, `PROBE_LOW_CONFIDENCE` (with category + missing element), `AUDIO_REPAIR`, `TIMEBOX_MOVE_ON`, `CLOSING`.

## Pilot role — rubric and question plan

The v1 rubric has four dimensions (categories), each scored 1–4:

| Dimension (`key`) | Meaning | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| **Problem Solving** (`problem_solving`) | Finds clever, elegant solutions to hard problems. | Downvoted. | Found a solution alongside others. | Accepted answer on Stack Overflow. | Front page on Hacker News. |
| **Agency** (`agency`) | Stops at nothing to solve a problem. | Does not meet expectations. | Does everything expected/asked. | Puts in more effort than expected. | Hacked or broke rules to solve the problem. |
| **Competitiveness** (`competitiveness`) | Gets consumed by a desire to win. | Absence of competitiveness. | Does not like to lose. | Emotionally affected by losing. | Competitive to a detrimental degree in some facet of life. |
| **Curious** (`curious`) | Needs to know the *why* behind everything, and acts on it. | Absence of curiosity. | Signs of curiosity but no action. | Very curious about something and takes action. | Obsessively curious — becomes an expert. |

The 1–4 anchors are illustrative *levels*, not literal checklists: the Scorer places the candidate by the **spirit** of each anchor (e.g. Problem Solving = 4 means an achievement of roughly "Hacker News front page" magnitude and recognition, not that literal event), and scores the level actually demonstrated regardless of which level the question invited.

**Bare-minimum rule** — the meets-bar recommendation: **at least one dimension scored 4, AND Problem Solving ≥ 3.** Stored in the rubric config; the assessment reports `meets_bare_minimum` against it. It is a recommendation — a human reviewer signs off.

**Base questions** — four verbatim questions, each primarily targeting one dimension. (The Scorer still picks up incidental evidence for any dimension from any answer; the mapping only decides which dimension a question's probes target.)

| ID | Verbatim question (spoken exactly) | Primary dimension |
|---|---|---|
| `q1` | "Can you tell me about a technically complex problem you solved with a clever or hacky solution?" | Problem Solving |
| `q2` | "Can you tell me about the time you hacked a non-computer system to your advantage?" | Agency |
| `q3` | "Can you tell me about an area of your life where your competitiveness became so intense that it cost you something? Maybe it was detrimental physically, mentally, or emotionally?" | Competitiveness |
| `q4` | "Can you tell me about a niche or obscure topic that no one knows about but you are an expert in? Meaning you are in the top 1% of this thing that is extremely niche?" | Curious |

Each question is stored in the *Question schema* form above. Because every dimension has exactly one base question, a thin answer is probed — within that question's probe and time budget — until the dimension is confidently scored.

## State machine

`scheduled → candidate_joined → preflight_complete → consent_captured → intro → question_N_asking → question_N_answering → question_N_scoring → question_N_probing_M → question_N_closed → … → closing → recording_finalizing → review_ready`

`question_N_scoring` runs the Scorer; it transitions to `question_N_probing_M` (loop, bounded by `max_probes` and time) or to `question_N_closed`. Disconnects, timeouts, and failures have explicit transitions (see *Error handling*).

## Recording & artifacts

Per interview, stored under `/{org_id}/interviews/{session_id}/`:
```
media/      composite.mp4 · candidate_video.mp4 · candidate_audio.m4a · agent_audio.m4a
transcripts/ transcript.v1.json (question-aligned, diarized)
events/     agent_events.jsonl (utterances + reason codes) · media_events.jsonl
            integrity_events.jsonl (video signals)
assessment/ scores.json (per-category score + evidence + confidence + meets_bare_minimum) · integrity_flags.json
review/     reviewer_notes.json · signoff.json
audit/      consent.json · script_version.json · model_versions.json
```
Object storage with encryption at rest, private access + signed URLs, access logs, retention policy, deletion workflow, reviewer-scoped permissions. Raw media stored separately from derived artifacts.

## Error handling

- **STT/TTS failure or latency spike** — graceful holding behavior ("one moment"), retry; the swappable Voice I/O layer makes the provider replaceable.
- **Scorer timeout** — the controller advances rather than blocking; the category is marked low-confidence and flagged. The agent never fabricates a question or a score.
- **STT mishears** — the controller may issue an `AUDIO_REPAIR` clarification rather than scoring a garbled answer.
- **Candidate disconnect / network loss** — attempt room reconnect; pause the interview timer during disconnection up to a cap; mark unreliable transcript sections; preserve partial recording; on hard failure, end gracefully and mark the assessment incomplete — never a silent partial score, never a silently discarded interview.
- **Video pipeline failure** — the interview continues uninterrupted (video is non-critical); integrity signals are marked unavailable for that session.
- **Recording finalization failure** — treated as a first-class workflow with retries, status, and alerts.
- **Integrity flags never auto-reject** — surfaced to the human reviewer only.

## Testing strategy

- **Eval harness — primary correctness gate for the Scorer:** corpus replay, score-agreement metrics vs. human scores, explicit pass threshold.
- **Controller unit tests:** the probe-vs-advance decision against synthetic Scorer outputs; timing-budget enforcement; state-machine transitions including disconnect/timeout paths.
- **Scorer/Probe unit tests:** synthetic transcripts exercising low-confidence detection and that probes target the named missing element.
- **Voice I/O integration tests:** simulated candidate audio through the full pipeline; verbatim-question fidelity (the spoken text equals the script).
- **Video pipeline tests:** labeled clips — on-screen vs. reading off-screen, single vs. multiple faces.
- **Compliance tests:** consent gating blocks recording until consent; deletion-on-request removes all candidate data; the audit log is complete and immutable.
- **Interviewer-fidelity checks** (before any reliance on scoring): every base question asked, asked verbatim, within the time cap, probes within policy, transcript aligned to recording.

## Compliance requirements (binding)

Hiring AI is **high-risk under the EU AI Act**, with high-risk obligations enforceable **2026-08-02** (a proposed deferral exists but is not adopted — plan for this date). Also in scope: NYC Local Law 144 (AEDT bias audit + candidate notice), Colorado AI Act (employment obligations from 2026-06-30), Illinois AIVIA (disclosure, opt-in consent, 30-day deletion on request) and HB 3773 (no discriminatory AI in hiring; no ZIP-code proxy), and Illinois BIPA — relevant to any video/face processing.

Concrete v1 requirements: explicit candidate disclosure that the interviewer is AI + opt-in consent before recording; full transcript/recording retention with deletion-on-request; **every assessment is a recommendation requiring human sign-off** — no autonomous reject/advance; immutable audit log of script versions, model versions, utterances, and scores; **no facial or emotion analysis** (workplace emotion recognition is itself prohibited under the EU AI Act); assessment based on answer content only. Video integrity signals are advisory, disclosed, applied consistently, human-reviewed, and never determinative. Employment counsel reviews before automated scoring influences any decision.

## Tech stack & repository shape

A **monorepo**:
- `agent/` — Python, LiveKit Agents. The agent worker: Voice I/O, Controller, Scorer, Probe Generator, Video Perception. ECC Python coding standards imported.
- `room/` — TypeScript web app — the candidate interview room.
- `review/` — TypeScript web app — the internal review tool.
- `backend/` — TypeScript — Scheduler/API, Orchestrator, Finalization. ECC TypeScript coding standards imported.
- `rubric/`, `eval/` — rubric config and the eval/calibration harness.

Models/services: streaming STT, a semantic turn-detection model, TTS (low-latency) for Voice I/O; a frontier reasoning LLM for the Scorer and Probe Generator (selected in planning); a VLM for video perception. LiveKit (Agents + Egress + Cloud or self-hosted) for media and recording.

## Manual-gate operations (for the implementation plan)

Tasks that must halt the autonomous run for operator approval: running an interview with a **real candidate**; any **deploy/release**; **schema migrations** on shared data; enabling any **reduction of human oversight** over scoring.

## Build order (phased in the implementation plan)

Full multimodal is v1 scope; this is the *sequence* — it front-loads de-risking, per the cofounder's "prove fidelity, evaluate before scoring" guidance.
1. Monorepo scaffold; ECC Python + TypeScript coding standards; compliance scaffolding (consent, audit log, data model); Rubric & Assessment Store.
2. **Live Rubric Scorer + Eval & Calibration Harness — prove the IP offline against the corpus first.**
3. First-party room + LiveKit media/recording + cascaded Voice I/O + Interview Controller — the live voice loop, using the validated Scorer.
4. Video Perception Pipeline — integrity signals + turn hint.
5. Review App + platform integration API + end-to-end calibration on the pilot role.

Later phases (post-v1): lightweight visual presence → avatar provider; Zoom/Meet meeting-bot adapters; dialing back human oversight once corpus + live validation justify it.

## Open questions (resolved during planning)

- Exact LLM for the Scorer and Probe Generator (a frontier reasoning model).
- LiveKit Cloud vs. self-hosted.
- Persistence layer and data residency — aligned with the cofounder's platform.
- Specific STT / turn-detection / TTS / VLM vendors — chosen for latency, quality, and cost in planning.
