# Interviewer Room Scaffolding Design

**Date:** 2026-06-18
**Status:** approved for implementation planning

## Problem

The current interview room is candidate-only. The candidate invite URL drives
consent, device preflight, recording startup, room readiness, AI interviewer
dispatch, and the LiveKit join token. That works for unattended AI interviews,
but it does not support a human interviewer who creates the interview from the
dashboard, joins first, gives the candidate a link, and controls when the AI
interviewer starts.

The new flow needs a first-class interviewer path. The interviewer is an
authenticated member of the host WorkOS organization. The candidate remains an
invite-based guest. Both join the same LiveKit room, but with different
participant roles, different pre-call UI, and different permissions.

## Goals

- A dashboard user can create an interview and immediately enter a full-screen
  interviewer pre-call room.
- The interviewer pre-call room shows the candidate invite URL and provides a
  copy action.
- The interviewer skips candidate AI disclosure, recording consent copy, and
  required pre-call device checks.
- The candidate still uses the candidate invite URL and must complete the
  existing disclosure, consent, and device flow.
- Backend-issued LiveKit tokens identify participants as `candidate` or
  `interviewer`.
- A same-org WorkOS member can join as an interviewer. A non-member cannot use
  the interviewer route.
- In-room interviewer UI includes an AI interviewer control beside the leave
  button.
- Stop and Resume AI actions are recorded durably, but do not yet pause or
  resume the worker.

## Non-Goals

- No real pause/resume behavior in the AI worker yet.
- No multi-interviewer coordination rules beyond allowing multiple same-org
  members to join as interviewers.
- No candidate access to the authenticated interviewer route.
- No role inference from browser referrer or dashboard navigation history.
- No change to candidate consent requirements.

## Decisions

The product will use two routes:

- Interviewer route: `/dashboard/interviews/[sessionId]/join`
- Candidate route: `/interview/[token]`

The dashboard action will create the session and candidate invite, then navigate
the authenticated host to the interviewer route. The interviewer route will be
full-screen like the candidate pre-call experience, not inside dashboard chrome.

The candidate invite URL is candidate-scoped. The interviewer copies that URL
from the interviewer pre-call room and sends it to the candidate over the
existing Google Meet conversation.

The backend, not the browser, decides participant role:

- Interviewer role requires an active WorkOS session whose `organizationId`
  matches the session `org_id`.
- Candidate role requires a valid candidate invite token.

## User Flow

1. The host is already in a Google Meet with the candidate.
2. The host clicks **Create and join interview** in the dashboard.
3. Platform creates a backend interview session and candidate invite.
4. Platform redirects the host to `/dashboard/interviews/[sessionId]/join`.
5. The interviewer pre-call room displays the candidate invite URL and a copy
   button.
6. The interviewer joins the LiveKit room as `interviewer`. Browser camera and
   microphone permissions can be requested at join time if the interviewer
   publishes media, but they are not a required pre-call checklist.
7. The interviewer sends the copied candidate URL in Google Meet.
8. The candidate opens `/interview/[token]`, completes consent and preflight,
   and joins the same LiveKit room as `candidate`.
9. Because a human interviewer is present, the AI interviewer does not start
   automatically. The interviewer starts it from the room controls.
10. During the call, the interviewer can press Stop AI or Resume AI. For this
    phase, those actions only update backend state and audit/events.

## Architecture

### Platform

The dashboard creation API should continue to create the backend session and
candidate invite. Its response should include enough data for the dashboard to
redirect to the interviewer route and for the interviewer route to display the
candidate invite URL.

The interviewer route should be implemented as an authenticated page. It should
use the current WorkOS session to require same-org access before rendering the
full-screen pre-call UI.

The existing candidate page remains invite-token based and continues to render
the consent-driven candidate experience.

### Backend

The backend needs an interviewer join surface separate from candidate invite
join. It should:

- Load the session by `sessionId`.
- Require the caller's `organizationId` to match `sessions.org_id`.
- Prepare or reuse the LiveKit room.
- Issue a LiveKit token with `participant_kind: "interviewer"`.
- Record `interviewer_joined` and reconnect-style events.

The candidate join path should keep issuing `participant_kind: "candidate"`.
It should not be responsible for authenticating interviewers.

### LiveKit

LiveKit room capacity must allow more than candidate plus AI. The existing room
provisioning cap should be raised enough for at least one candidate, multiple
interviewers, and the AI interviewer.

Participant identity and metadata should be explicit:

- Candidate identity: stable candidate invite participant identity.
- Interviewer identity: stable identity derived from WorkOS user/session data
  and the session id.
- Metadata includes `session_id`, `participant_kind`, and the relevant user or
  invite identifier.

### AI Interviewer Dispatch

For unattended interviews, the AI interviewer may continue to auto-dispatch
when the candidate joins.

For interviewer-led interviews, the backend should record the requested AI
state. The first implementation records control intent only. A later worker
change can consume the state and actually start, pause, or resume the agent.

The implementation should avoid letting the AI worker accidentally treat an
interviewer as the candidate. Future worker changes should bind the agent's
listening participant to the participant with `participant_kind: "candidate"`.

## UI Design

### Interviewer Pre-Call Room

The interviewer pre-call room should feel like the candidate pre-call room but
with interviewer-specific content:

- Full-screen layout.
- Candidate invite URL display.
- Copy candidate link button.
- Join room button.
- No candidate AI disclosure, recording consent checklist, or candidate data-use
  copy.
- No required camera/microphone preflight checklist.

The room should make the candidate link the primary object to copy before the
host joins or while waiting for the candidate. It can request browser media
permissions later, when the interviewer chooses to join the live room.

### Interviewer In-Call Room

The existing call UI should adapt to participant role:

- Candidate sees the current candidate controls.
- Interviewer sees interviewer controls.
- Interviewer controls include an AI button beside the leave button.
- Button labels:
  - `Start AI` before the AI is requested.
  - `Stop AI` once AI is considered running/requested.
  - `Resume AI` after a stop request.

The button should show request progress and disabled/error states if the
backend request fails.

## Backend State and Events

The first implementation can persist AI control state as session-scoped state
or as auditable events, depending on the smallest clean fit with the current
schema. The API must record:

- Requested state: `running` or `stopped`.
- Actor email or user id.
- Session id.
- Timestamp.

Events should be persisted through the existing ops/audit event path where
possible:

- `interviewer_joined`
- `interviewer_reconnected`
- `ai_interviewer_start_requested`
- `ai_interviewer_stop_requested`
- `ai_interviewer_resume_requested`

These events do not imply the worker actually changed behavior in this phase.

## Error Handling

- If the interviewer is not signed in, redirect to WorkOS login and return to
  the interviewer route afterward.
- If the signed-in user is not a member of the session's org, show the existing
  not-authorized treatment.
- If the session is terminal, show a full-screen ended state.
- If LiveKit room readiness fails, keep the user in pre-call with a retryable
  error.
- If the AI control request fails, keep the previous local AI state and show a
  concise error near the control.
- If copying the candidate link fails, leave the URL visible and selectable.

## Testing

Backend tests should cover:

- Interviewer join rejects missing or mismatched org identity.
- Interviewer join returns a LiveKit token with `participant_kind:
  "interviewer"`.
- Candidate join still returns `participant_kind: "candidate"`.
- Room max participant capacity supports candidate, AI, and interviewers.
- AI control requests persist the expected events/state without invoking worker
  pause/resume behavior.

Platform tests should cover:

- Dashboard create-and-join response/redirect targets the interviewer route.
- Interviewer route requires same-org WorkOS membership.
- Interviewer pre-call UI shows copy candidate link and no candidate consent
  checklist.
- Candidate invite route still shows the existing candidate consent flow.

Manual verification should cover:

- Host creates and joins from dashboard.
- Host copies candidate URL.
- Candidate joins from copied URL.
- Host sees Start/Stop/Resume AI controls.
- Stop/Resume requests are visible in backend events/audit records.

## Risks

- The current agent waits for a participant if no explicit candidate identity is
  provided. The worker must not start listening to an interviewer in future
  agent-control work.
- The current candidate join path starts recording and updates session status.
  Interviewer joins must not create candidate consent records or impersonate
  candidate join semantics.
- Existing dashboard and backend files have active unrelated work. The
  implementation should keep edits narrowly scoped and avoid reverting unrelated
  changes.
