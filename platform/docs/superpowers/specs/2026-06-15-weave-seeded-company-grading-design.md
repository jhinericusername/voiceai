# Weave-Seeded Company Grading Design

## Summary

Puddle V1 should unlock AI-generated interview recommendations as soon as a
company admin approves a role rubric. Ashby onboarding connects the company,
selected Ashby jobs define the role scope, and Weave's historical interview
data seeds the first company-oriented grading profiles.

The goal is acceleration: approved rubrics produce immediate `Advance`, `Hold`,
or `Pass` recommendations with evidence. Calibration and reviewer feedback
improve quality over time, but they do not block V1 recommendations after rubric
approval.

## Current Context

- Ashby self-serve onboarding already validates API keys, stores encrypted
  customer secrets, selects Ashby jobs, configures webhooks, and syncs active
  applications.
- Puddle-conducted interviews already use the shared dashboard packet model:
  `sessions`, `recordings`, `recording_artifacts`, `transcript_turns`, and
  `assessments`.
- The dashboard interview detail page already renders real interview packets
  and signs available composite video artifacts.
- The `historical-fireflies-import` worktree implements the missing Fireflies
  import path. It imports historical Weave Fireflies recordings as Puddle
  sessions with `external_source = 'fireflies'`, copies media and transcripts
  into the Puddle artifacts bucket, writes transcript turns, and preserves
  Ashby application match evidence in `sessions.source_metadata`.
- A verified dry run found 338 historical Fireflies recordings, 322 selected
  Weave matches, 343 ranked match candidates, and 16 unindexed recordings.
- A verified one-record apply imported
  `hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8` with composite video, candidate
  audio, transcript artifact, and 385 transcript turns.
- The agent currently loads a static YAML rubric (`pilot-v1`) and produces
  rubric category scores from transcript text.

## Product Decision

Rubric approval is the V1 recommendation gate.

After a workspace admin approves a role rubric, Puddle may generate
AI-assisted recommendations for both:

- historical Weave Fireflies packets imported into Puddle, and
- new Puddle-conducted interviews.

Calibration status affects confidence, monitoring, warnings, and rubric
iteration. It does not block recommendation generation in V1.

## Goals

1. Use Weave's existing interview and Ashby data as the default V1 source
   dataset for company-oriented grading.
2. Extend Ashby onboarding from "connected integration" to "approved hiring
   bar and active recommendations".
3. Create versioned role grading profiles for selected Ashby jobs.
4. Generate draft rubrics from Weave historical packets, Ashby job context, and
   the existing Puddle pilot rubric.
5. Require admin approval before recommendations are enabled for a role.
6. Re-score historical Weave packets against approved role rubrics so customers
   can inspect how recommendations would have behaved on prior interviews.
7. Apply the same scoring and recommendation path to historical Fireflies
   interviews and new Puddle interviews.
8. Store reviewer decisions and overrides as structured feedback for ongoing
   calibration and future rubric versions.

## Non-Goals

- No model fine-tuning in V1.
- No hidden company grading prompt that cannot be reviewed or versioned.
- No recommendation unlock before a role rubric is approved.
- No automatic hiring action or outbound candidate communication.
- No use of protected characteristics, appearance, voice quality, accent,
  emotion, facial expression, or other disallowed signals for scoring or
  recommendations.
- No domain-based data access. WorkOS organization membership remains the
  tenant boundary.

## V1 Onboarding Workflow

### 1. Connect Ashby

The admin enters an Ashby API key. The backend validates it with Ashby's
`job.list`, stores the key encrypted, creates or rotates the per-company
webhook secret, and returns open jobs.

Existing implementation already covers this state.

### 2. Select Jobs

The admin selects one or more Ashby jobs that Puddle should screen. Each
selected job becomes a candidate for a role grading profile.

The selected Ashby job ID is the role scope for:

- active Ashby applications,
- imported Weave application matches,
- approved rubric version,
- recommendation thresholds,
- historical backfill scoring jobs, and
- future Puddle interview sessions.

### 3. Import Or Confirm Weave Historical Packets

For the Weave org, Puddle should use the historical Fireflies import branch as
the source path. The import creates reviewable sessions from the Fireflies S3
inventory and enriches them with Weave Ashby match data.

The selected Ashby application ID is more important than candidate ID alone.
A candidate can have multiple applications, so imported packets must preserve
application-level match evidence in `sessions.source_metadata.ashby`.

### 4. Generate Draft Role Rubrics

For each selected Ashby job, Puddle generates a draft role grading profile from:

- the current Puddle pilot rubric,
- Ashby job title and available job metadata,
- selected historical Weave packets for the job,
- transcript-derived interview behavior and evidence patterns,
- historical Weave Ashby application linkage, and
- any admin-provided hiring-bar notes.

The draft must be a structured, versioned rubric, not only a prompt.

### 5. Admin Approves Rubric

The admin reviews and approves:

- dimensions,
- 1-4 anchors per dimension,
- bare-minimum rule,
- recommendation thresholds,
- interview question plan,
- evidence coverage expectations,
- disallowed signals, and
- whether historical Weave packets should be backfilled immediately.

Approval creates an immutable rubric version and marks the role grading profile
as `recommendations_active`.

### 6. Backfill Historical Recommendations

Once the rubric is approved, Puddle queues scoring jobs for imported Weave
packets attached to the selected Ashby job.

Each job reads transcript turns and artifacts from the unified interview packet
model, runs the scorer against the approved rubric version, then runs the
recommendation engine.

Historical packets become a launch demonstration and calibration substrate:
reviewers can inspect recordings, transcript evidence, scores, and the AI
recommendation for real prior interviews.

### 7. Score New Puddle Interviews

New interviews created for the same Ashby job use the approved role grading
profile. After transcript and artifact finalization, the same scorer and
recommendation engine produce a review packet recommendation.

## Data Model

### `role_grading_profiles`

One mutable profile per organization and Ashby job.

```text
profile_id text primary key
organization_id text not null
ashby_integration_id text not null
ashby_job_id text not null
status text not null
active_rubric_version_id text null
draft_rubric_version_id text null
created_by_email text not null
updated_by_email text not null
created_at timestamptz not null
updated_at timestamptz not null
unique (organization_id, ashby_job_id)
```

Status values:

```text
draft_needed
draft_ready
approval_required
recommendations_active
paused
```

### `role_rubric_versions`

Immutable approved or draft rubric versions.

```text
rubric_version_id text primary key
profile_id text not null
organization_id text not null
ashby_job_id text not null
version integer not null
status text not null
rubric jsonb not null
generation_inputs jsonb not null
approved_by_email text null
approved_at timestamptz null
created_at timestamptz not null
unique (profile_id, version)
```

Status values:

```text
draft
approved
archived
```

The `rubric` JSON should include:

```text
script_version
dimensions
anchors
questions
bare_minimum_rule
recommendation_thresholds
evidence_requirements
disallowed_signals
```

### `interview_recommendations`

One generated recommendation per session and rubric version.

```text
recommendation_id text primary key
session_id text not null
organization_id text not null
ashby_job_id text not null
rubric_version_id text not null
source text not null
recommendation text not null
confidence numeric not null
category_scores jsonb not null
evidence jsonb not null
warnings jsonb not null
model_metadata jsonb not null
created_at timestamptz not null
unique (session_id, rubric_version_id)
```

Recommendation values:

```text
advance
hold
pass
```

### `reviewer_feedback`

Reviewer decisions and overrides become calibration data.

```text
feedback_id text primary key
recommendation_id text not null
session_id text not null
organization_id text not null
reviewer_email text not null
reviewer_decision text not null
override_reason text null
dimension_feedback jsonb not null
created_at timestamptz not null
```

Reviewer decision values:

```text
advance
hold
pass
needs_more_review
```

## Recommendation Engine

Scoring and recommendation should remain separate components.

```text
Scorer:
  transcript + approved rubric -> category scores, confidence, evidence

Recommendation engine:
  category scores + thresholds + warnings -> Advance/Hold/Pass
```

The V1 recommendation engine should be deterministic and inspectable.

Default rule shape:

```text
Advance:
  meets bare-minimum rule
  enough evidence coverage
  no severe integrity or policy warning
  confidence at or above profile threshold

Hold:
  mixed signal
  low confidence
  missing evidence
  moderate integrity warning
  scorer output needs reviewer attention

Pass:
  fails bare-minimum rule
  enough evidence coverage
  no unresolved low-confidence blocker
```

When rules conflict, choose `hold`. `Hold` is the safe recommendation for
uncertainty, not a failure state.

## Weave Data Usage

Weave data should drive V1 in three ways.

### Rubric Drafting

Historical transcripts reveal what questions were actually asked, which
answers produced strong signal, and what evidence patterns recur across
successful or weak candidates.

The draft rubric generator should use Weave transcripts as examples and
summaries, not as raw permanent prompt text in the rubric.

### Historical Recommendation Backfill

After rubric approval, imported Weave sessions can be scored immediately.
This gives the team an inspectable set of real recommendations before new
Puddle interviews accumulate.

### Calibration And Monitoring

Reviewer decisions on historical packets provide the first feedback set:

- agreement rate by recommendation,
- dimension-level disagreements,
- common override reasons,
- low-confidence categories,
- evidence coverage gaps, and
- rubric anchors that need revision.

This is V1 calibration. It should improve the rubric and prompt versions before
any fine-tuning work is considered.

## Backend Interfaces

### Profile State

```text
POST /grading/company-state
```

Returns selected jobs, grading profile state, active rubric versions, draft
status, backfill status, and recommendation readiness.

### Draft Rubric

```text
POST /grading/profiles/:profileId/draft
```

Generates or regenerates a draft rubric from Ashby and Weave context.

### Approve Rubric

```text
POST /grading/profiles/:profileId/approve
```

Validates the rubric schema, creates an approved immutable version, sets the
profile to `recommendations_active`, and optionally enqueues historical
backfill jobs.

### Score Session

```text
POST /grading/recommendations/session/:sessionId
```

Scores one session against the active rubric version for the session's Ashby
job. This route is useful for retries and manual backfills.

### Feedback

```text
POST /grading/recommendations/:recommendationId/feedback
```

Stores reviewer decision, override reason, and dimension-level feedback.

## Platform UI

Ashby onboarding should become a multi-stage setup surface.

```text
Connect Ashby
Select jobs
Build hiring bars
Approve rubric
Backfill historical recommendations
Recommendations active
```

The role page should show:

- active rubric version,
- recommendation readiness,
- historical Weave packet count,
- scored historical packet count,
- reviewer agreement rate,
- latest overrides, and
- action to edit or create a new rubric version.

The interview packet page should show:

- source: Puddle live interview or historical Fireflies import,
- video and transcript,
- rubric version used,
- AI recommendation,
- category scores and evidence,
- warnings,
- reviewer decision controls, and
- override note capture.

## Security And Authorization

- WorkOS organization membership remains the tenant boundary.
- `ashby:onboarding:manage` or an equivalent grading setup permission is
  required to create drafts, approve rubrics, pause profiles, or run backfills.
- Dashboard viewers may inspect recommendations for their organization but
  cannot approve or mutate rubrics without the setup permission.
- Ashby secrets stay backend-only.
- Historical Weave application match evidence is candidate linkage context, not
  an authorization input.
- Imported historical rows must use the real WorkOS organization ID.

## Error Handling

- If Ashby is connected but no jobs are selected, grading state is
  `draft_needed`.
- If no Weave historical packets match a selected Ashby job, draft generation
  still works from the baseline rubric and Ashby job context, but the UI should
  disclose that historical examples are unavailable for that role.
- If a historical packet has no transcript turns, it cannot be scored and
  should show `recommendation_unavailable`.
- If scorer output is invalid, the session should be retryable and should not
  produce a recommendation.
- If recommendation rules hit conflicting signals, output `hold` with warnings.

## Testing

Unit tests:

- role grading profile state transitions,
- rubric schema validation,
- recommendation rules,
- Weave source metadata parsing,
- session-to-Ashby-job resolution,
- reviewer feedback validation.

Integration tests:

- Ashby connected plus selected job creates draft-needed profiles,
- approved rubric unlocks recommendations,
- historical Fireflies session can be scored from transcript turns,
- Puddle live session can be scored through the same path,
- reviewer override creates feedback without mutating the original
  recommendation,
- org member cannot access another org's grading profiles or recommendations,
- member without setup permission cannot approve rubrics or start backfills.

Manual verification:

- import or use existing Weave Fireflies packet,
- open the interview detail page,
- approve a role rubric for the packet's Ashby job,
- run historical recommendation backfill,
- verify the packet shows recording, transcript, rubric scorecard,
  recommendation, and reviewer decision controls.

## Rollout Order

1. Merge or port the historical Fireflies import worktree into `main`.
2. Add role grading profile and rubric version tables.
3. Add rubric draft generation using Weave historical context.
4. Add rubric approval and recommendation-active state.
5. Add deterministic recommendation engine.
6. Add historical backfill worker for Weave packets.
7. Add platform UI for grading setup and interview recommendation review.
8. Add feedback capture and agreement reporting.

This order makes Weave data useful immediately while preserving a clean path
for future company-specific model training.
