# Dashboard Review Workbench Design

## Goal

Turn the dashboard into a review desk for high-volume AI interviews. The two screens in scope are the workspace dashboard and the interview review view opened from that dashboard. Data remains local demo data, but it should read like Puddle's actual workflow: completed interviews, artifacts, transcript evidence, rubric scores, integrity signals, recommendations, and human review.

## Dashboard

The dashboard should prioritize reviewer throughput over generic workspace status.

- A top metric strip summarizes review-ready interviews, unassigned reviews, oldest review age, completed interviews today, and flagged integrity items.
- The main section is a review queue table. Each row should represent an interview packet, not an abstract candidate record.
- Queue columns should include candidate, role, score, recommendation, artifact readiness, integrity flags, reviewer, updated time, and an open-review action.
- A right-side rail should show live or finalizing interviews, artifact health, and recent review activity.
- Clicking an interview packet should open `/dashboard/interviews/[sessionId]`.

## Interview Review View

The review view should behave like a hiring-specific version of Fireflies or Read AI: media, transcript, scorecard, recommendation, and review controls are visible in one focused workspace.

- Header: candidate, role, session status, recommendation, score, review status, and navigation back to the dashboard.
- Media area: a code-native video/audio placeholder with realistic playback chrome, duration, timestamp, and evidence markers.
- Transcript area: timestamped turns grouped around interview questions, with evidence and risk markers surfaced inline.
- Scorecard area: rubric dimensions with score, bar signal, evidence, and rationale.
- Recommendation area: AI recommendation, integrity signals, reviewer assignment, and decision controls for Advance, Hold, Pass, and Mark reviewed.
- Artifact and audit areas remain available, but they support review rather than dominating the page.

## Data Model

Keep using `platform/app/dashboard/demo-data.ts`. Extend the demo model only where it improves the review workflow:

- Add review packet fields for transcript/audio/video availability.
- Add media markers for key evidence and integrity moments.
- Add fuller transcript turns for the selected review experience.
- Add queue helper functions that return sessions joined with candidate and role information.

## Constraints

- Do not connect real backend data yet.
- Do not change auth, WorkOS, candidate room, or backend behavior.
- Do not introduce new visual asset generation; this is a targeted redesign inside the existing dashboard design system.
- Keep cards compact with 8px-or-less radii and table-first information density.
- Preserve existing reusable primitives where practical.

## Verification

- Run platform lint/build/type checks available in the repo.
- Open `http://localhost:3000/dashboard` and verify the dashboard renders meaningful review data.
- Click or navigate to an interview review view and verify media, transcript, scorecard, recommendation, artifacts, and reviewer controls render without a framework overlay or console errors.
- Check desktop and one mobile viewport for layout overflow, clipped text, and broken table behavior.
