# Role Rubrics V1 Design

## Purpose

Create a V1 role rubric workflow for Weave-backed Puddle interviews. A dashboard user can create and update a rubric for each Ashby role, return to that role later and see the previously saved rubric, and have the active role rubric injected into the Bedrock grading prompt for candidates interviewed for that role.

## Goals

- Add a usable Rubric tab inside the role workspace.
- Store role rubrics so they persist across page visits and can be changed.
- Support 3 to 6 selected dimensions per role.
- Use Weave-specific dimension definitions and 1-4 anchors.
- Model Passion for Sales as one dimension with three internal sub-dimensions.
- Dynamically inject the active role rubric into the transcript scoring prompt based on the candidate session's Ashby role.
- Keep transcript-based grading from using accent as evidence.
- Preserve old recommendations by keeping them tied to the rubric version used when they were generated.

## Non-Goals

- No audio-based Communication analysis in V1.
- No arbitrary custom dimensions outside the Weave dimension library.
- No migration or deploy in this implementation step.
- No bulk regrading of historical interviews.
- No advanced version history UI. The database can preserve versions, but the V1 UI only needs current active and current draft states.

## Existing System Fit

The backend already has the right storage lifecycle:

- `role_grading_profiles` stores one grading profile per organization and Ashby job.
- `role_rubric_versions` stores rubric JSON versions.
- `draft_rubric_version_id` points to the editable draft.
- `active_rubric_version_id` points to the rubric used for recommendations.
- Recommendation generation already resolves the active rubric by `organizationId` and `ashbyJobId`.
- `buildScoringPrompt()` already injects `RUBRIC_JSON` into the model prompt.

V1 should use this structure rather than introduce new rubric tables.

## Rubric Content

The dimension library contains six Weave dimensions:

### Problem Solving

Definition: Finds clever, elegant solutions to hard problems.

| Score | Anchor |
| --- | --- |
| 1 | Downvoted. |
| 2 | Found a solution alongside others. |
| 3 | Accepted answer on Stack Overflow. |
| 4 | Front page on Hacker News. |

### Agency

Definition: Stops at nothing to solve a problem.

| Score | Anchor |
| --- | --- |
| 1 | Does not meet expectations. |
| 2 | Does everything expected or asked. |
| 3 | Puts in more effort than expected. |
| 4 | Hacked or broke rules to solve the problem. |

### Competitiveness

Definition: Gets consumed by a desire to win.

| Score | Anchor |
| --- | --- |
| 1 | Absence of competitiveness. |
| 2 | Does not like to lose. |
| 3 | Emotionally affected by losing. |
| 4 | Competitive to a detrimental degree in some facet of life. |

### Curiosity

Definition: Needs to know the why behind everything, and acts on it.

| Score | Anchor |
| --- | --- |
| 1 | Absence of curiosity. |
| 2 | Signs of curiosity but no action. |
| 3 | Very curious about something and takes action. |
| 4 | Obsessively curious, becomes an expert. |

### Communication

Definition: Engages in conversation by listening, understanding, and articulating themselves.

| Score | Anchor |
| --- | --- |
| 1 | Choppy, incomprehensible, or hard to follow. |
| 2 | Articulates themselves well. |
| 3 | Enjoyable to talk to and articulates themselves well. |
| 4 | Asks clarifying questions, enjoyable to talk to, and articulates themselves clearly. |

Accent must not be included in transcript-based grading. It remains a disallowed signal.

### Passion for Sales

Definition: Figures out a way to be at the top of the leaderboard.

Passion for Sales is one rubric dimension with one final score. The scorer uses three internal sub-dimensions to decide that final score:

| Sub-Dimension | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| Reason for Getting Into Sales | Fell into it | Family in sales | Founder-oriented / personally interested | Money-motivated |
| Professional Sales Background | No training | Self-taught | Formal training | Self-taught + formal training |
| Performance as a Salesperson | No promos / job hopping | Some promotions / promotions due to tenure | Top performer and bored | Cannot be promoted |

Passion for Sales questions:

- Why'd you get into sales?
- How did you learn how to sell?
- Where has that led you to today?

Additional communication signals that may support evaluation when present:

- Answers directly.
- Concision.
- Attention over time.
- Storytelling.

## Rubric JSON Shape

Keep the current top-level `RoleRubric` structure and extend dimensions to support optional sub-dimensions.

```ts
interface RoleRubricDimension {
  key: string;
  name: string;
  meaning: string;
  anchors: Record<1 | 2 | 3 | 4, string>;
  sub_dimensions?: RoleRubricSubDimension[];
}

interface RoleRubricSubDimension {
  key: string;
  name: string;
  anchors: Record<1 | 2 | 3 | 4, string>;
}
```

For `passion_for_sales`, `anchors` can summarize the rollup behavior, while `sub_dimensions` carries the detailed Reason, Background, and Performance grid.

Validation rules:

- A rubric must have 3 to 6 dimensions.
- Each dimension key must come from the Weave dimension library.
- Dimension keys must be unique.
- Each dimension must have anchors 1, 2, 3, and 4.
- Each sub-dimension, when present, must have anchors 1, 2, 3, and 4.
- `Communication` must not contain accent-based scoring language.
- `disallowed_signals` must include `accent`.
- Questions must refer only to selected dimension keys.

## Dashboard Behavior

The role workspace already has a Rubric tab. V1 should replace its empty state with a role-scoped editor.

When the role page loads:

- Fetch company grading state for the signed-in user's organization.
- Match the current role by Ashby job ID.
- If a draft rubric exists, show the draft.
- Else if an active rubric exists, show the active rubric.
- Else show an empty creation state with the dimension library.

The editor supports:

- Selecting 3 to 6 dimensions from the Weave library.
- Viewing and editing the definition and 1-4 anchors for selected dimensions.
- Viewing and editing Passion for Sales sub-dimension anchors.
- Saving a draft.
- Approving the current draft as active.
- Displaying whether the shown rubric is active, draft, or not yet configured.

For V1, changes are full-rubric saves. Fine-grained field autosave is not required. When the user saves, the edited rubric must be persisted as the current draft so returning to the role shows the last saved state even before approval.

## Platform API

Add dashboard API routes that derive organization and actor identity from the WorkOS session:

- `POST /api/grading/company-state`
- `POST /api/grading/profiles/[profileId]/draft`
- `POST /api/grading/profiles/[profileId]/approve`

These proxy to the existing backend grading endpoints. The browser should not be trusted to provide the organization boundary.

Draft save payload:

```json
{
  "jobName": "Account Executive",
  "rubric": {
    "script_version": "job_123-v1",
    "role": {
      "organization_id": "org_123",
      "ashby_job_id": "job_123",
      "title": "Account Executive"
    },
    "dimensions": [
      {
        "key": "communication",
        "name": "Communication",
        "meaning": "Engages in conversation by listening, understanding, and articulating themselves.",
        "anchors": {
          "1": "Choppy, incomprehensible, or hard to follow.",
          "2": "Articulates themselves well.",
          "3": "Enjoyable to talk to and articulates themselves well.",
          "4": "Asks clarifying questions, enjoyable to talk to, and articulates themselves clearly."
        }
      }
    ]
  }
}
```

The example is abbreviated to one dimension for readability. Real submitted rubrics must include 3 to 6 dimensions plus the required policy, question, disallowed-signal, and generation-context fields. The platform route supplies `organizationId` and `actorEmail`. The backend validates the full rubric and stores it as the profile's current draft version. If the user is creating a rubric for the first time, the same endpoint creates the first draft. If the user is changing an active rubric, the same endpoint creates a new draft version without mutating the active version.

Access control:

- Require dashboard organization membership.
- Require Ashby readiness because role rubrics depend on synced Ashby jobs.
- Use `organizationId` from the WorkOS session.
- Use the signed-in user's email as `actorEmail`.

## Backend Changes

Backend changes are intentionally small:

- Extend the role rubric dimension type to allow optional sub-dimensions.
- Add Communication and Passion for Sales to the default Weave dimension library.
- Update draft generation so it can create role rubrics from selected dimensions rather than always cloning the pilot four-dimension rubric.
- Update the draft route so it can persist a submitted full rubric as the current draft, not only generate a default seed.
- Tighten rubric validation for 3 to 6 dimensions and known dimension keys.
- Ensure validation rejects Communication rubric text that uses accent as a grading criterion.
- Keep `accent` in `disallowed_signals`.
- Make scoring prompt instructions explicit that only dimensions in `RUBRIC_JSON.dimensions` should be scored.
- Ensure Passion for Sales returns one final category score, not one score per sub-dimension.

The Bedrock `ConverseCommand` wrapper does not need structural changes. The prompt content is the control point.

## Scoring Flow

1. A candidate interview session has source metadata containing the selected Ashby job ID.
2. Recommendation generation receives the session ID and organization ID.
3. The backend resolves the session's Ashby job ID.
4. The backend loads the active rubric for that organization and Ashby job.
5. The backend builds the scoring prompt with that rubric as `RUBRIC_JSON`.
6. The prompt instructs the model to score only the selected rubric dimensions.
7. The parsed scorecard is stored with the active `rubricVersionId`.

If no active rubric exists for the role, recommendation generation should continue to fail with `active rubric is required`.

## Recommendation Compatibility

Past recommendations must remain tied to the rubric version they used.

Changing a role rubric should:

- Save the edited rubric as a new current draft version.
- Require approval to become active.
- Affect future recommendations using the new active version.
- Not mutate existing `interview_recommendations` rows.

## Testing

Backend tests:

- Draft rubric generation includes all six Weave dimensions in the library.
- Validation accepts a 3 to 6 dimension rubric.
- Validation rejects fewer than 3 or more than 6 dimensions.
- Validation rejects unknown dimension keys.
- Validation accepts Passion for Sales with sub-dimensions.
- Validation rejects malformed sub-dimension anchors.
- Validation rejects accent-based Communication scoring language.
- Session recommendation prompt includes only the active role rubric dimensions.

Platform tests:

- Role Rubric tab source includes company-state fetch and saved rubric rendering.
- Dashboard grading API routes derive organization and actor identity server-side.
- Rubric editor enforces 3 to 6 selected dimensions.
- Passion for Sales renders as one dimension with three sub-dimension rows.

Manual checks:

- Open a role with no rubric and create one.
- Return to the same role and confirm the saved rubric appears.
- Edit and approve the rubric, then refresh and confirm the approved version appears.
- Generate a recommendation for a session on that role and confirm the scorecard dimensions match the role rubric.

## Open Decisions

None. V1 will use the Weave dimension library, persist role rubrics, allow changes through draft approval, and inject the active role rubric into the scoring prompt.
