# LiveKit AI Participant Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI interviewer join the LiveKit room as a visible participant, pause/resume in memory, and be removable from the meeting.

**Architecture:** Keep backend logic thin: server routes dispatch and remove the LiveKit agent because those require privileged LiveKit APIs. Host-side UI sends pause/resume over the existing LiveKit room data channel, while the Python agent preserves runner state in memory and gates speaking/listening when paused.

**Tech Stack:** Next.js/React, `livekit-client`, Fastify backend, `livekit-server-sdk`, Python LiveKit Agents.

---

### Task 1: Backend Dispatch And Removal

**Files:**
- Modify: `backend/src/livekit/provision.ts`
- Modify: `backend/src/interviewers/routes.ts`
- Modify: `backend/src/interviewers/repository.ts`
- Test: `backend/test/interviewers.test.ts`
- Test: `backend/test/livekit-egress.test.ts`

- [ ] Add exported helpers to create/list agent dispatches and remove the agent participant from a room.
- [ ] Extend `/internal/interviews/:sessionId/ai-control` so `start` and `resume` dispatch `puddle-interviewer` idempotently, while `end` removes the AI participant and records an ended state.
- [ ] Keep `stop` as durable intent only; pause/resume signaling is client-to-agent through LiveKit data.
- [ ] Add tests for start/resume idempotent dispatch, stop no dispatch/removal, and end removal.
- [ ] Run `pnpm --filter @puddle/backend test -- test/interviewers.test.ts test/livekit-egress.test.ts`.

### Task 2: Agent Pause/Resume Control

**Files:**
- Modify: `agent/src/agent/controller/interview.py`
- Modify: `agent/src/agent/voice/livekit_session.py`
- Modify: `agent/src/agent/worker/entrypoint.py`
- Test: `agent/tests/test_interview_runner.py`
- Test: `agent/tests/test_livekit_session_voice.py`
- Test: `agent/tests/test_worker_entrypoint.py`

- [ ] Add an in-memory control object with `pause`, `resume`, and `end` semantics.
- [ ] Gate the interview runner before `speak()` and `listen()` so paused AI does not advance.
- [ ] Wire LiveKit room data/text control messages into the control object.
- [ ] Pass candidate identity from dispatch metadata to `LiveKitSessionVoiceAgent.start(...)` so the agent links only to the candidate.
- [ ] Add unit tests for pause waiting, resume continuation, and candidate identity forwarding.
- [ ] Run focused agent tests.

### Task 3: Host And Candidate Room UI

**Files:**
- Modify: `platform/app/dashboard/interviews/[sessionId]/join/InterviewerJoinClient.tsx`
- Modify: `platform/app/interview/[token]/InterviewJoinClient.tsx`
- Modify: `platform/app/api/dashboard/interviews/[sessionId]/ai-control/route.ts`
- Test: `platform/tests/interviewer-room-source.test.mjs`

- [ ] Add `End AI` as a separate host control.
- [ ] Make `Start AI`/`Resume AI` call backend dispatch, `Stop AI` send a LiveKit data command, and `End AI` call backend removal.
- [ ] Track remote participants by kind/identity and render the AI as a visible tile with paused/running/ended state.
- [ ] Add source tests for the new controls and data-channel command path.
- [ ] Run `pnpm --filter @puddle/platform test`.

### Task 4: Integration Verification

**Files:**
- No new files expected.

- [ ] Run focused backend, platform, and agent tests.
- [ ] Review diffs for unrelated dirty changes and preserve user edits.
- [ ] Summarize exact behavior and remaining live-smoke-test gap.
