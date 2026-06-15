# Ashby-First Puddle Dashboard Design

Date: 2026-06-15

## Goal

Build Puddle as an Ashby-first interviewing operations dashboard. Ashby remains the operational source for jobs, candidates, applications, and current application stage. Puddle owns AI interview invitations, sessions, recordings, transcripts, reviews, email templates used by Puddle, and dashboard configuration.

This design replaces the current dummy-data dashboard direction. Users should not see fake roles, fake candidates, or demo review queues in production paths. Until Ashby onboarding is complete, authenticated users see setup-only states.

## Recommended Approach

Use an Ashby-first dashboard with a Puddle-owned interview layer.

Rejected alternatives:

- A Fireflies-style recording dashboard first. This is too media-library oriented and should not define the product architecture.
- A candidate-first CRM. This is useful later, but review work and rubrics are role-specific, so the primary object should be jobs/roles.

## App State And Navigation

Dashboard access is gated by Ashby onboarding. A user must be in a WorkOS organization with the right permissions, and that organization must have completed enough Ashby setup to operate the dashboard.

Before onboarding is complete:

- Show setup-only UI.
- Do not show dashboard navigation.
- Do not show dummy roles, candidates, review queues, or historical recordings.
- Admins with setup permission can configure Ashby.
- Non-admin users see a setup-pending state.

After onboarding is complete, the left navigation is:

- Roles: default landing page.
- Candidates: all synced Ashby candidate/application records Puddle can act on.
- Review Queue: permanent tab, but always starts with a role picker.
- Recordings: live Puddle and imported Fireflies playback/transcript library.
- Analytics: reserved for throughput and review metrics.
- Settings: Ashby connection, selected jobs, stage mappings, templates, members, permissions, and webhooks.

The center/top navigation can mirror the active workspace with tabs such as Roles, Candidates, and Review.

Global Cmd+K search only searches candidates/applications by name. It does not search recordings, transcript text, summaries, or raw metadata.

## Primary Dashboard Object

The primary dashboard object is an Ashby job/role.

The Roles page shows one row per selected Ashby job with three Puddle pipeline states:

- Send interviews
- Scheduled
- Needs review

These are Puddle states, not hard-coded Ashby stage names.

## Role Stage Mapping

Admins configure stage mappings per role. Each role can have different Ashby stages while Puddle still exposes the same three-state interviewing workflow.

For each selected job, admins configure:

- Source Ashby stages that feed Send interviews.
- The target Ashby stage after Puddle sends an AI interview.
- Ashby stages that count as Scheduled.
- Ashby stages that count as Needs review.
- Review outcome destinations from any stage in that same role, plus archive/reject.

Candidate membership in each Puddle state is derived from Ashby current stage plus Puddle interview state. Ashby remains the current-stage source of truth. Puddle stores mappings, invitation/session status, review state, and audit events.

## Sending AI Interviews

Puddle supports two send surfaces:

- Bulk send from a role's Send interviews view.
- Single send from a candidate/application profile.

The single-send action should use a small paper-plane/send icon when the application is eligible. Eligibility is determined by the role's configured Send interviews stages. If an application is not in an eligible stage, the action is hidden or disabled with a clear human-readable reason.

Both bulk and single send open the same Ashby-style composer before delivery.

The composer includes:

- Template selector.
- Send timing, initially "Immediately".
- From address.
- Recipient list.
- Subject.
- Body preview/editor.
- Final Send action.

For bulk send, the composer shows selected recipient count and allows the sender to inspect or remove recipients before sending. For single send, the same composer opens with one recipient.

When the user clicks Send:

- Puddle creates invite/session records.
- Puddle sends the email through its own mail system.
- Puddle records an audit event.
- Puddle immediately moves the Ashby application to the configured interview sent/scheduled stage.

Future Cal support should allow candidates to book a time with the AI as part of the scheduled flow. For v1, sending immediately moves candidates into the configured sent/scheduled stage.

## Email Templates

Puddle owns the templates used for Puddle interview invitation emails.

Ashby templates can be imported into Puddle during onboarding or from Settings. Imported templates become independent Puddle copies.

Rules:

- Puddle stores imported Ashby templates.
- Admins can edit imported templates in Puddle.
- Admins can create new Puddle templates from scratch.
- Puddle edits never write back into Ashby.
- The send composer only uses Puddle-stored templates.

Template variables should be human-readable and role/interview focused, such as candidate first name, job name, and interview link. The dashboard should not expose implementation variable names in normal user-facing views unless the user is actively editing a template.

## Review Queue

Review Queue is a permanent left-navigation tab, but it never opens a pooled cross-role inbox.

The Review Queue always starts with a role picker. Users must explicitly choose which job's queue they are reviewing.

After selecting a role:

- The header shows the active role.
- The active rubric is visible.
- Only applications for that role appear.
- Scores, dimensions, recommendations, and review actions use that role's rubric.

Review outcomes are Ashby-stage driven. The current Ashby stage appears as a dropdown. Changing it updates Ashby immediately, like Ashby's own stage dropdown.

Allowed destinations:

- Any stage in the same role.
- Archive/reject.

The dropdown remains editable after a move so a reviewer can move the application again later. Puddle records review notes, scores, reviewer identity, and audit events.

## Interview Playback And Review Page

Opening an interview should preserve the useful Fireflies interaction pattern:

- Video/audio playback on the left.
- Transcript on the right.
- Summary and review material below or adjacent to playback.
- Human-readable candidate, job, application, and meeting context visible.
- Clear source labels such as "Historical Fireflies import" when relevant.

The normal dashboard must not show UUIDs, raw Ashby IDs, transcript IDs, storage paths, JSON keys, or internal implementation fields. Those can exist in the database and logs, and may later appear in an explicit admin/debug view, but they do not belong in ordinary recruiter/reviewer UI.

## Historical Fireflies Data

Historical Fireflies should be imported as content inside the normal Ashby-first model. It should not define the product architecture.

Rules:

- Historical recordings remain hidden until Ashby onboarding is complete.
- Imported Fireflies rows are scoped by WorkOS organization membership, not email domain.
- Imported recordings link to Ashby applications when Weave reconciliation has a selected match.
- Ranked match candidates are retained for reconciliation/admin use, not normal dashboard clutter.
- If a recording exists in S3 but not the Weave DB, import it as historical/unindexed content for the Weave org.
- The Recordings page can show historical recordings as a library.
- The Review Queue includes historical recordings only when they are linked to a role/application and fall into the selected role's review context.
- Playback uses the Fireflies-style media/transcript/summary layout.

The full historical Fireflies import should wait until onboarding-first gating, role scoping, and visibility rules are implemented. The already-imported test row can remain but should not become the model for normal dashboard access.

## Authentication And Authorization

Authentication and authorization remain separate.

- WorkOS organization membership is the tenant boundary.
- WorkOS permissions control actions such as managing Ashby setup, sending interviews, reviewing interviews, editing templates, and changing settings.
- Email domain is not an authorization boundary.
- Dashboard access requires org membership and completed Ashby onboarding.
- Historical Weave data must only be visible to users authorized in the Weave WorkOS organization.

## Visual Design Principles

The dashboard should feel operational and clear, closer to Ashby and Fireflies than a marketing page.

Principles:

- Use real data and real empty states, not dummy data.
- Keep review pages human-readable.
- Avoid surfacing technical identifiers in normal views.
- Keep role and rubric context explicit.
- Use compact, scannable pipeline rows and tables.
- Use familiar icons for common actions, including a paper-plane/send icon for AI interview sends.
- A small Puddle turtle mascot is allowed in onboarding, empty states, and friendly setup moments, but should not clutter operational tables or review workflows.

Available mascot/logo assets may be copied during implementation from the existing Puddle public asset set, including:

- `puddle-mascot.svg`
- `puddle-mascot.png`
- `puddle-logo.svg`
- `puddle-symbol.svg`

The mascot should support the experience without replacing clear product copy or action-oriented UI.

## Rollout Order

1. Restore and implement onboarding-first dashboard gating.
2. Remove dummy/demo data fallbacks from production dashboard routes.
3. Build the Ashby-backed roles, candidates, and stage-mapping foundation.
4. Build Puddle template import/create/edit and the composer send flow.
5. Build the role-scoped Review Queue and Fireflies-style playback/review page.
6. Continue the historical Fireflies import only after visibility and role-scoping rules are in place.

## Acceptance Criteria

- Users without completed Ashby onboarding cannot access operational dashboard pages.
- Production dashboard paths do not use dummy roles, candidates, review queues, or demo recordings.
- Roles is the default dashboard landing page after onboarding.
- Each selected Ashby job shows Send interviews, Scheduled, and Needs review counts.
- Admins can configure which Ashby stages feed each Puddle state per role.
- Review Queue always starts with a role picker.
- Review pages show role-specific rubric context.
- Reviewers can move an application immediately to any stage in the same role or archive/reject.
- Bulk AI interview send is supported through an email composer confirmation.
- Single candidate send is available from candidate profile when eligible.
- Puddle can import Ashby email templates as independent Puddle-owned templates.
- Puddle-created templates are supported.
- Cmd+K searches only candidates/applications.
- Historical Fireflies recordings are visible only after onboarding and only under correct org authorization.
- Normal dashboard UI does not expose UUIDs, raw IDs, storage paths, JSON blobs, or internal field names.

## Out Of Scope For This Design

- Building the Cal scheduling integration now.
- Two-way template sync back to Ashby.
- Transcript full-text search.
- Public historical recording links.
- Domain-based authorization.
- Full historical Fireflies import before dashboard gating and visibility are correct.
