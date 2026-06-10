# Internal Ashby Webhooks Design

## Summary

Puddle will use a direct, internal Ashby integration instead of a marketplace-style onboarding flow. One person from a company domain connects Ashby, configures the required webhooks, and runs an initial active-candidate sync. After that, other signed-in Puddle users from the same company domain can use the connected Ashby workspace without repeating onboarding or needing their own Ashby permissions.

This design keeps Ashby secrets and synced ATS state in the backend. The Next.js platform app receives Ashby webhook calls, verifies them, forwards accepted events to the backend, and renders dashboard data returned by the backend.

## Current Context

- The platform app is a Next.js 16.2.6 App Router project.
- The dashboard is currently demo-data-driven under `app/dashboard`.
- Operational API work already proxies to `PUDDLE_BACKEND_BASE_URL`, for example `POST /api/interviews` and `POST /api/livekit/webhook`.
- There is no committed persistence layer in the platform app.
- `proxy.ts` currently exempts `api/livekit/webhook` from WorkOS auth. The Ashby webhook route needs the same treatment because Ashby will call it without a WorkOS session.
- Next.js route handlers should keep secret handling server-side. The relevant Next docs read for this design were route handlers, server/client components, data fetching, environment variables, and authentication.

## Goals

1. Make `/dashboard` primarily show the most recent screens.
2. Add a role-level `Score` tab where a reviewer can pick an active Ashby candidate/application, enter four rubric scores from `0` to `4` in `0.5` steps, add comments, and save the score.
3. Add an internal Ashby webhook receiver at `POST /api/ashby/webhook`.
4. Support manual Ashby webhook setup for Puddle's own use and early customer startups.
5. Let same-domain teammates skip Ashby onboarding once one user from that company domain has completed setup.
6. Keep Ashby API keys, webhook secrets, idempotency records, active candidate sync state, and score records in the backend.

## Non-Goals

- No OAuth or public marketplace integration flow.
- No multi-ATS abstraction in the first implementation.
- No polished customer-facing onboarding wizard.
- No automatic Ashby webhook creation in the first implementation.
- No Ashby score writeback until the local score workflow is stable.

## Company Integration Access

Puddle treats Ashby as a company-level integration.

The integration key should be resolved as:

1. Use the WorkOS `organizationId` when present.
2. Also store the signed-in user's normalized email domain, such as `company.com`.
3. If `organizationId` is missing, use the normalized email domain as the company key.

When a signed-in user visits the dashboard:

1. The platform asks the backend for the current company integration state.
2. The backend returns `connected` if an active Ashby integration exists for the user's `organizationId` or normalized email domain.
3. If `connected`, the platform bypasses Ashby onboarding and shows synced candidates/screens.
4. If not connected, the platform shows the internal setup instructions.

This bypass does not bypass Puddle authentication or allowed-domain checks. It only bypasses the requirement for every user to personally configure Ashby. The first user who completes setup becomes the integration owner for that company domain, and subsequent same-domain users inherit access to the synced company-level Ashby data.

## Internal Setup Flow

The initial internal setup can be a runbook plus minimal dashboard state.

1. A Puddle user signs in with an allowed company email domain.
2. The user adds backend environment/config values for the company:
   - Ashby API key.
   - Ashby webhook secret.
   - Company domain.
   - Optional WorkOS organization ID.
   - Selected Ashby job IDs to sync.
3. The user creates Ashby webhooks manually in Ashby, all pointing to `https://<platform-domain>/api/ashby/webhook`.
4. Ashby sends a `ping`; Puddle verifies the signature and forwards the event to the backend.
5. The backend records the integration as connected after it receives and accepts a valid `ping`.
6. A one-time backend sync pulls active applications for the selected Ashby jobs.

Required webhook events for v1:

- `ping`
- `applicationSubmit`
- `applicationUpdate`
- `candidateStageChange`
- `candidateDelete`
- `candidateMerge`
- `candidateHire`

The runbook should tell the setup user to create one webhook per event type if Ashby requires event-specific webhook settings, using the same request URL and secret for each.

## Webhook Receiver

Create `app/api/ashby/webhook/route.ts`.

Behavior:

1. Export `dynamic = "force-dynamic"`.
2. Read the raw request body with `request.text()`.
3. Read the `Ashby-Signature` header.
4. Verify HMAC SHA-256 using `PUDDLE_ASHBY_WEBHOOK_SECRET`.
5. Reject missing or invalid signatures with `401`.
6. Parse JSON only after verification succeeds.
7. Accept `ping` with `200`.
8. Forward every verified event to `POST ${PUDDLE_BACKEND_BASE_URL}/integrations/ashby/webhook`.
9. Include `Authorization: Bearer ${PUDDLE_BACKEND_INTERNAL_TOKEN}` when configured.
10. Return `200` when the backend accepts the event.
11. Return `502` if the backend is unavailable.

Update `proxy.ts` so `api/ashby/webhook` is excluded from WorkOS auth.

## Backend Responsibilities

The backend owns durable state.

Data it must store:

- Company integration records keyed by WorkOS organization ID and normalized email domain.
- Encrypted Ashby API keys.
- Ashby webhook secret references or encrypted secret values.
- Selected Ashby job IDs.
- Webhook event idempotency records keyed by Ashby `webhookActionId`.
- Synced Ashby candidates and active applications.
- Puddle screen/session mappings.
- Puddle score records.

Webhook processing:

1. Deduplicate events by `webhookActionId`.
2. Upsert candidate/application records from webhook payloads.
3. For update events with partial payloads, fetch application details from Ashby using the stored API key.
4. Mark deleted or merged candidates as inactive.
5. Mark hired candidates and inactive applications so they stop appearing in the active scoring search.

Initial sync:

1. For each selected Ashby job ID, call Ashby `application.list` with `status: "Active"`.
2. Store application ID, candidate ID, candidate name, email, job ID, current stage, source, and updated timestamp.
3. Repeat with pagination until all active applications are synced.

## Dashboard Behavior

`/dashboard` should become a focused recent screens view.

When Ashby is connected:

- Show recent screens sorted by latest activity.
- Include candidate, role, screen status, score, recommendation, updated time, and open action.
- Show empty state if no screens exist.

When Ashby is not connected:

- Show an internal Ashby setup panel.
- Explain the current company domain that will own the integration.
- Show the platform webhook URL.
- Show required webhook events.
- Show whether the latest `ping` has been received.

## Score Tab

Add a `Score` tab to the role workspace.

Behavior:

- Candidate input searches synced active Ashby applications for the selected role/job.
- The user must select an Ashby-backed application before saving.
- The score form contains:
  - Problem Solving.
  - Agency.
  - Competitiveness.
  - Curious.
  - Comments.
- Each score allows values from `0` to `4` in `0.5` steps.
- Sum is calculated automatically.
- There is one save button.
- There is no standalone "Add Candidate" button.

Saving creates or updates a Puddle score record in the backend and links it to the Ashby application ID. The score tab does not write the score back to Ashby in v1.

## Error Handling

- Invalid webhook signatures return `401` and are not forwarded.
- Valid webhooks with malformed JSON return `400`.
- Valid webhooks that the backend rejects return the backend status when safe, otherwise `502`.
- Duplicate webhook events return `200` after the backend confirms the event was already processed.
- If Ashby is connected but active-candidate sync has not completed, candidate search shows a sync-in-progress empty state.
- Same-domain users who have Puddle access but no Ashby permissions can still use the connected integration once the backend marks it connected.

## Testing

Platform tests:

- Webhook route accepts a valid `ping`.
- Webhook route rejects missing signatures.
- Webhook route rejects invalid signatures.
- Webhook route forwards verified events to the backend.
- Proxy matcher excludes `api/ashby/webhook`.
- Score tab calculates sums correctly for `0.5` steps.
- Score tab requires an Ashby application selection before save.

Backend tests:

- Initial sync stores active applications for selected jobs.
- Webhook event deduplication uses `webhookActionId`.
- Candidate delete and merge events remove or redirect active candidate records.
- Same-domain integration lookup returns connected for later users from the same normalized domain.
- Organization ID lookup takes precedence when present.

Manual verification:

- Create Ashby `ping` webhook against a deployed platform URL.
- Confirm backend marks the company integration connected.
- Run initial sync.
- Sign in as another user with the same email domain and confirm onboarding is skipped.
- Open `/dashboard` and confirm recent screens are visible.
- Open role `Score` tab, pick an active candidate, score all four dimensions, save, and confirm the score appears on refresh.

## Design Decisions

- Direct Ashby integration is sufficient because this is for internal use and early startups.
- Manual webhook setup is acceptable for v1 because the setup user is technical and the number of companies is small.
- The platform app should not store Ashby secrets because it currently has no persistence layer and already delegates operational data to the backend.
- Same-domain onboarding bypass is intentionally company-level, not user-level, because early startup customers usually have one Ashby workspace per company.
- Score writeback to Ashby is deferred so Puddle can stabilize its own scoring model first.
