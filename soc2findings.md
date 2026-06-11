# SOC 2 Readiness Findings

Date: 2026-06-08

Scope: static review of the local repository against `soc2.md` and the follow-up scoring/recommendation discussion. No live AWS, WorkOS, DNS, headers, vendor contracts, or production environment values were verified.

## Executive Summary

The codebase has a real SOC-ready foundation for a controlled beta: invite-based candidate access, consent gating before LiveKit room credentials, a shallow `/healthz`, private backend infrastructure in CDK, private encrypted storage buckets, Secrets Manager usage, audit/event tables, and candidate-facing privacy/disclosure pages.

The main gaps are not "no SOC 2 report." They are operational and product-control gaps:

- Backend internal auth fails open if `PUDDLE_BACKEND_INTERNAL_TOKEN` is missing outside the CDK path.
- Dashboard authorization is domain-based, not role/permission-based.
- The product currently includes scoring/recommendations language and code, while `soc2.md` recommends no score/rank/pass-fail recommendation for the first controlled beta.
- Consent records are too thin for evidence-grade recording/AI consent.
- Recording/artifact storage is partially wired, but review access, signed media URLs, durable artifact upload, and retry/finalization workflows are incomplete.
- Retention/deletion has library support but no operational workflow or object deletion.
- There is no visible WAF/rate limiting, no CSP/security header baseline, and some container/deploy hardening gaps remain.
- No incident response plan, DPA template, vendor register, or formal security packet is present in the repo.

Recommendation: launch only as a controlled beta after the go-live blockers below are handled. Scoring can exist, but should be implemented and messaged as human-gated decision support, not autonomous employment decisioning.

## Launch Posture From `soc2.md`

`soc2.md` says a controlled beta can proceed if it is:

- Invite-only.
- Low volume.
- Known customer/design partner.
- Human review only.
- Explicit AI disclosure.
- Explicit recording consent.
- Authenticated admin access.
- No public session creation.
- Private recordings.
- Clear retention/deletion policy.
- Support path for candidate issues.
- Manual monitoring during interviews.

`soc2.md` says do not launch if:

- Public API can create sessions.
- Admin dashboard is weakly protected.
- Candidate recordings are accessible by guessable URLs.
- No `/healthz`.
- No recording finalization alerts.
- No consent record.
- No DPA/privacy notice.
- No access logs.
- No incident process.
- AI produces hiring recommendations without controls.
- AI scores candidates without controls.
- AI analyzes facial expressions, gaze, emotion, accent, or confidence.

## Scoring And Recommendation Stance

Scoring is probably core product value, so the right posture is not "no scoring ever." The safer posture is:

- Generate rubric dimension scores as draft decision support.
- Tie every score to transcript evidence, question coverage, confidence, and missing/ambiguous evidence.
- Require human reviewer signoff before any recommendation becomes final or customer-facing.
- Avoid beta ranking lists and pass/fail language.
- Use labels like "evidence supports moving forward," "needs second reviewer," "insufficient evidence," or "ready for human review" instead of "hire," "reject," "pass," or "fail."
- Make reviewer overrides first-class and audit logged.
- Keep candidate disclosure aligned with actual product behavior.

Relevant evidence:

- Agent scoring exists and runs during the interview loop: `agent/src/agent/controller/interview.py:132`.
- Agent rolls up category assessments into a final assessment: `agent/src/agent/controller/interview.py:145`.
- Integration response currently returns `recommendation: "meets_bar" | "below_bar"` and also includes `humanSignedOff`: `backend/src/integration/contract.ts:61`.
- `toAssessmentResponse` returns a recommendation even when `reviewerEmail` is null, while marking `humanSignedOff` false: `backend/src/integration/contract.ts:74`.
- Review signoff primitives exist: `review/src/signoff.ts:18`.
- Review UI can display video, category scores, integrity flags, and reviewer email signoff, but it is not yet integrated into the authenticated platform dashboard: `review/src/pages/ReviewSession.tsx:15`.
- Runbook says approving the scorer for live scoring requires operator and employment-counsel signoff: `docs/RUNBOOK.md:84`.

Finding: scoring can stay, but beta should treat all scores/recommendations as draft until human signoff. Consider changing the API shape so unsigned assessments return `draftRecommendation` or `reviewState: "unsigned"` instead of a final-looking recommendation.

## Findings By Area

### 1. Backend Access And Session Creation

What exists:

- Backend registers internal auth before state-changing routes: `backend/src/server.ts:82`.
- Auth middleware targets `POST /sessions`, `/integration/*`, `/candidate/invites/*`, and `/internal/*`: `backend/src/integration/internal-auth.ts:3`.
- CDK injects `PUDDLE_BACKEND_INTERNAL_TOKEN` into backend, platform, and agent tasks: `infra/lib/infra-stack.ts:943`, `infra/lib/infra-stack.ts:1239`, `infra/lib/infra-stack.ts:1129`.
- CDK blocks public backend exposure entirely for now: `infra/lib/infra-stack.ts:217`.
- Backend ALB is internal: `infra/lib/infra-stack.ts:1019`.
- Backend ECS service runs without public IP: `infra/lib/infra-stack.ts:1034`.

Gaps:

- Auth fails open when `PUDDLE_BACKEND_INTERNAL_TOKEN` is missing. `registerInternalAuth` returns without installing a hook: `backend/src/integration/internal-auth.ts:45`.
- `/sessions` still exists as a direct scheduler route and does not validate the contract beyond `buildSessionRecord`: `backend/src/scheduler/routes.ts:16`.
- Integration create-session validation only checks required fields and minimum TTL, not email format, timestamp validity, max lengths, script-version allowlist, or object shape: `backend/src/integration/contract.ts:23`.

Assessment:

- CDK-managed deployment is reasonably protected because the backend is private and receives the internal token.
- Non-CDK deployments, local tunnels, or future public exposure could accidentally become unsafe because auth is token-optional.

Recommended next steps:

- Fail closed in production if `PUDDLE_BACKEND_INTERNAL_TOKEN` is absent.
- Add explicit local-only bypass such as `PUDDLE_BACKEND_AUTH_DISABLED=true`.
- Retire or strictly protect `/sessions`.
- Add stronger runtime validation for session creation.

### 2. Platform Authentication And Authorization

What exists:

- Platform uses WorkOS AuthKit proxy: `platform/proxy.ts:1`.
- Dashboard layout requires a signed-in user: `platform/app/dashboard/layout.tsx:13`.
- Dashboard auth checks allowed email domain: `platform/app/dashboard/auth.ts:5`.
- Interview creation route requires WorkOS user and allowed domain: `platform/app/api/interviews/route.ts:41`.
- Team invitation route requires WorkOS user and allowed domain: `platform/app/api/team-invitations/route.ts:45`.

Gaps:

- Privileged actions are protected by domain, not explicit role/permission.
- Any signed-in user from an allowed domain appears able to create candidate interviews.
- Any signed-in user from an allowed domain appears able to send team invitations.
- The dashboard reads demo data, not real org-scoped backend rows: `platform/app/dashboard/interviews/[sessionId]/page.tsx:3`.

Assessment:

- Good enough for a tiny founder-controlled pilot only if WorkOS tenant setup externally restricts who can sign in.
- Not enough for customer workspaces or broader pilots.

Recommended next steps:

- Enforce WorkOS role/permission claims server-side for `interviews:create`, `team:invite`, review access, and admin actions.
- Add org-scoped checks for every real session/artifact read.
- Ensure candidate/session/reviewer data is not served from static params or demo fixtures once live.

### 3. Candidate Invite Flow

What exists:

- Invite tokens are 32 random bytes, base64url encoded, and prefixed with `inv_`: `backend/src/invites/tokens.ts:3`.
- Invite tokens are hashed before storage: `backend/src/invites/tokens.ts:9`.
- Candidate invite table stores token hash, status, not-before, expiry, revoked timestamp, last-used timestamp, and join count: `backend/migrations/002_candidate_invites.sql:3`.
- Join checks token existence, expiry/revocation, and session joinability before room readiness or token issuance: `backend/src/invites/routes.ts:271`.
- Candidate LiveKit tokens are room-scoped and short-lived: `backend/src/livekit/token.ts:18`.

Gaps:

- Invites are not strictly single-use. `markCandidateInviteUsedStatement` increments `join_count`, but `isInviteUsable` does not reject already-used invites: `backend/src/invites/repository.ts:85`.
- This may be intentional to support reconnects, but it differs from `soc2.md`'s "single-use signed invite link" language.
- No visible rate limiting or abuse throttling exists for join attempts.

Assessment:

- Token entropy and hashing are strong.
- For launch, decide explicitly whether candidate invites are single-use, reusable until expiry, or reusable only within an active session/reconnect window.

Recommended next steps:

- Add rate limiting at WAF/edge and/or app level.
- Consider separate semantics for first join versus reconnect.
- Add invite revocation/admin controls if not already handled outside repo.

### 4. Candidate Consent And Disclosure

What exists:

- Candidate UI has explicit checkboxes for AI disclosure, recording/data processing, and AI-assisted review outputs: `platform/app/interview/[token]/InterviewJoinClient.tsx:53`.
- Candidate cannot enter until notices are accepted and device preflight passes: `platform/app/interview/[token]/InterviewJoinClient.tsx:568`.
- Candidate join API sends consent booleans and timestamp to backend: `platform/app/interview/[token]/InterviewJoinClient.tsx:610`.
- Backend requires data-use acknowledgement, AI disclosure acknowledgement, and recording consent before generating room credentials: `backend/src/invites/routes.ts:240`, `backend/src/consent/repository.ts:11`.
- Consent is persisted in `consent_records`: `backend/migrations/001_init.sql:14`.
- Candidate-facing links to AI disclosure, privacy, terms, and subprocessors are shown before joining: `platform/app/interview/[token]/InterviewJoinClient.tsx:627`.
- Privacy and AI disclosure pages mention candidate rights/accommodation: `platform/app/legalPages.ts:58`, `platform/app/legalPages.ts:177`.

Gaps:

- Consent record only stores `session_id`, `candidate_email`, booleans, and `consented_at`: `backend/migrations/001_init.sql:14`.
- Missing fields from `soc2.md`: consent text version, IP address, user agent, checkbox values as versioned text, customer/company, recording policy version, privacy notice version.
- Consent is upserted by session and can overwrite prior values instead of preserving an append-only consent history: `backend/src/consent/repository.ts:42`.
- Candidate copy currently says Puddle may create scores, rankings, and recommendations: `platform/app/interview/[token]/InterviewJoinClient.tsx:56`.

Assessment:

- The consent gate is real and valuable.
- The evidence record is not yet strong enough for a recording/AI consent audit trail.

Recommended next steps:

- Version the candidate consent/disclosure text.
- Persist IP, user agent, org/customer, notice version, privacy version, and recording policy version.
- Make consent append-only or preserve historical versions.
- If beta avoids ranking, remove "rankings" from candidate/legal copy.

### 5. Recording, Storage, And Artifact Handling

What exists:

- Recording is opt-in via `PUDDLE_RECORDINGS_ENABLED`: `backend/src/livekit/egress.ts:54`.
- Egress S3 config requires bucket, region, access key, and secret when recording is enabled: `backend/src/livekit/egress.ts:60`.
- Backend starts LiveKit room composite recording during join when recording is enabled: `backend/src/invites/routes.ts:321`.
- LiveKit webhook route verifies webhook signatures before persistence: `backend/src/livekit/webhooks.ts:144`.
- Recording and artifact tables exist: `backend/migrations/003_interview_artifacts.sql:20`.
- Artifact path layout exists for media, transcripts, events, assessment, review, and audit artifacts: `backend/src/storage/layout.ts:1`.
- CDK artifact bucket blocks public access, enforces SSL, is encrypted, versioned, and access-logged: `infra/lib/infra-stack.ts:495`.
- LiveKit Egress upload user is only created when recordings are enabled: `infra/lib/infra-stack.ts:680`.

Gaps:

- Runbook still lists object storage client/artifact upload as a known v1 gap: `docs/RUNBOOK.md:105`.
- Webhook persistence updates composite video status only. Other expected artifacts remain expected unless later workflow fills them.
- Agent default live path writes agent events to local container disk under `/app/artifacts/...`, not visibly to S3/backend in the default path: `agent/src/agent/worker/entrypoint.py:106`.
- No visible signed URL generation for reviewer playback.
- No visible playback/download audit events.
- No visible recording retry/finalization workflow beyond LiveKit webhook status mapping.

Assessment:

- Private S3 infrastructure and metadata tables are good.
- End-to-end durable artifact workflow is incomplete for live customer review.

Recommended next steps:

- Wire artifact upload/finalization into backend/agent.
- Generate short-lived signed URLs for reviewer playback.
- Audit playback/open/download events.
- Add recording finalization alerts and retry workflows.
- Ensure no permanent public media URLs are logged or exposed.

### 6. Review Access And Human Signoff

What exists:

- `assessments` table has `reviewer_email` and `signed_off_at`: `backend/migrations/001_init.sql:22`.
- Review signoff requires reviewer identity: `review/src/signoff.ts:18`.
- Reviewer may override category scores within range: `review/src/signoff.ts:29`.
- Review session UI can show composite VOD, integrity flags, category scores, and signoff input: `review/src/pages/ReviewSession.tsx:15`.
- Platform dashboard has pages for sessions, candidates, scorecards, and artifacts, but uses demo data: `platform/app/dashboard/demo-data.ts:956`.

Gaps:

- Review app appears separate and not integrated into WorkOS-authenticated platform.
- No visible backend route for assessment retrieval, reviewer signoff persistence, score override persistence, or signoff audit logging.
- No visible org-scoped artifact access.
- `toAssessmentResponse` can return a recommendation even if `humanSignedOff` is false: `backend/src/integration/contract.ts:74`.

Assessment:

- Human review is represented in types/UI, but not operationally enforced in the live platform path.

Recommended next steps:

- Treat model output as draft until reviewer signoff is persisted.
- Gate any external recommendation on `signed_off_at`.
- Audit signoff and overrides.
- Integrate real review data into the WorkOS-protected dashboard.

### 7. Audit Logging And Evidence

What exists:

- `events` table stores session event payloads: `backend/migrations/001_init.sql:33`.
- `audit_log` table stores event type, payload, previous hash, entry hash, and timestamp: `backend/migrations/001_init.sql:43`.
- Backend `persistOpsEvent` writes both event and hash-chained audit record: `backend/src/events/repository.ts:78`.
- Agent file-level audit log writer exists and can verify hash chains: `agent/src/agent/audit_log.py:1`.
- Video perception writes integrity events to audit log when wired: `agent/src/agent/video/perception.py:55`.

Gaps:

- Backend audit currently covers ops events that call `persistOpsEvent`; not all important actions are visibly audited.
- No visible audit logging for reviewer playback, downloads, score edits, signoff, consent text version, model version, or prompt version.
- Agent local audit/artifact logs are not visibly persisted to backend/S3 in the live default path.

Assessment:

- Good primitives, incomplete coverage.

Recommended next steps:

- Define auditable events by control: consent, invite creation, join, recording start/fail/complete, artifact view/download, score generation, reviewer override, signoff, deletion, secret rotation, admin access changes.
- Persist model/prompt/script versions with scores and outputs.
- Add tests around audit event creation for sensitive actions.

### 8. Privacy, Retention, And Deletion

What exists:

- Privacy page has retention/deletion language: `platform/app/legalPages.ts:51`.
- Deletion plan covers candidate data tables in child-before-parent order: `backend/src/db/deletion.ts:17`.
- Deletion plan includes object storage prefix when org id is supplied: `backend/src/db/deletion.ts:29`.
- S3 artifact bucket has noncurrent version expiration and multipart abort lifecycle rules: `infra/lib/infra-stack.ts:506`.

Gaps:

- No exposed deletion request/admin workflow.
- `executeDeletion` deletes database rows only. It does not delete S3 objects under `storagePrefix`: `backend/src/db/deletion.ts:42`.
- Artifact bucket has no current-object retention/expiration policy.
- No documented retention schedule by data category.
- No DPA template found.
- No formal vendor register found beyond public subprocessors copy.

Assessment:

- Basic deletion primitives exist, but retention/deletion is not operational.

Recommended next steps:

- Define retention windows by data class and environment.
- Implement S3 deletion for the session prefix.
- Add customer/candidate deletion request workflow.
- Record deletion audit events.
- Add backup/legal-hold exceptions and restoration implications.

### 9. AI And Employment Compliance Controls

What exists:

- Candidate disclosure says AI interviewer is used and outputs may support human review: `platform/app/interview/[token]/InterviewJoinClient.tsx:56`.
- Privacy/AI disclosure pages state Puddle does not itself hire, reject, or communicate outcomes: `platform/app/legalPages.ts:30`, `platform/app/legalPages.ts:139`.
- VLM prompt explicitly says not to identify the person or infer emotion/mood/demeanor: `agent/src/agent/video/vlm.py:21`.
- Video perception comments say integrity signals are advisory and not fed to the scorer: `agent/src/agent/video/perception.py:4`.
- Runbook gates live scoring approval on operator and employment-counsel signoff: `docs/RUNBOOK.md:84`.

Gaps:

- Candidate and legal copy includes scores, rankings, and recommendations; this conflicts with the stricter controlled-beta posture in `soc2.md`.
- Agent scoring is built into the interview loop.
- `meets_bare_minimum` and recommendation mapping are present.
- The VLM includes `reading_off_screen`, which is gaze-like even though not emotion/identity analysis: `agent/src/agent/video/vlm.py:27`.
- Runbook says video frame-pump is not wired in live run, so VLM integrity flags are currently a future enablement concern: `docs/RUNBOOK.md:105`.
- No bias audit, adverse impact analysis, or model governance evidence exists in the repo.

Assessment:

- The product is already in AI decision-support territory.
- This is manageable if positioned as human-gated, evidence-linked, disclosed, overrideable recommendation support.

Recommended next steps:

- Remove ranking from beta if not required.
- Ensure recommendations are draft until human signoff.
- Keep all score/recommendation outputs tied to evidence and confidence.
- Add bias/evaluation process before using scores to materially influence hiring decisions.
- Add accommodation/alternative-process operational path.

### 10. Infrastructure And Secrets

What exists:

- VPC uses public ingress, private app, and isolated data subnets: `infra/lib/infra-stack.ts:314`.
- RDS is private, encrypted, backed up, and not publicly accessible: `infra/lib/infra-stack.ts:592`.
- Runtime secrets are in Secrets Manager and injected into ECS tasks: `infra/lib/infra-stack.ts:622`.
- ECR repositories enable image scanning and immutable tags in prod: `infra/lib/infra-stack.ts:550`.
- Log groups have explicit retention: `infra/lib/infra-stack.ts:744`.
- Platform prod container deploy requires certificate ARN: `infra/lib/infra-stack.ts:289`.
- Platform ALB access logs are enabled: `infra/lib/infra-stack.ts:1212`.

Gaps:

- Backend sets `DATABASE_SSL_REJECT_UNAUTHORIZED=false` in deployed env: `infra/lib/infra-stack.ts:935`.
- Service image tags default to `latest` when not configured: `infra/lib/infra-stack.ts:894`, `infra/lib/infra-stack.ts:1215`.
- GitHub OIDC role, if enabled, trusts all refs in the repo pattern: `infra/lib/infra-stack.ts:1376`.
- No visible WAF.
- No visible app or edge rate limits.
- No current-object artifact retention.

Assessment:

- CDK is strong for private networking, secrets, and storage privacy.
- Needs production hardening before broader launch.

Recommended next steps:

- Enable DB certificate verification with RDS CA bundle.
- Require explicit image tags/digests for stage/prod service deploys.
- Narrow GitHub OIDC to protected branches/environments.
- Add WAF/rate-based rules.
- Add current object retention/expiration policy after legal/product retention decision.

### 11. Application Security Hardening

What exists:

- LiveKit webhooks are signature verified: `backend/src/livekit/webhooks.ts:156`.
- SQL statements reviewed use parameterized queries.
- Candidate invite tokens are high entropy and hashed.
- Agent Dockerfile runs as non-root user: `agent/Dockerfile:25`.

Gaps:

- `platform/next.config.ts` has no security headers: `platform/next.config.ts:3`.
- No visible CSP, HSTS, X-Frame-Options/frame-ancestors, Referrer-Policy, Permissions-Policy, or nosniff setup in repo.
- Backend and platform Node runtime containers do not set a non-root `USER`: `backend/Dockerfile:21`, `platform/Dockerfile:19`.
- No rate-limit dependency or middleware found.
- No CSRF-specific control was visible for state-changing platform routes; WorkOS/AuthKit may mitigate some paths, but app-level intent is not documented.

Assessment:

- No obvious catastrophic appsec issue was confirmed in static review, but defense-in-depth is thin on the public platform edge.

Recommended next steps:

- Add security headers in Next or edge/CDN.
- Add WAF and rate limiting.
- Run Node containers as non-root.
- Add application-level quotas around interview creation, team invitations, and join attempts.

### 12. Operational Readiness

What exists:

- Runbook exists for setup, tests, local run, deployment, calibration, and known v1 gaps: `docs/RUNBOOK.md:1`.
- Backend, agent, and platform Dockerfiles exist.
- CDK can deploy backend behind internal ALB and platform behind public ALB.
- Backend and platform Dockerfiles include health checks: `backend/Dockerfile:34`, `platform/Dockerfile:33`.

Gaps:

- Runbook says no CI/CD: `docs/RUNBOOK.md:107`.
- No incident response plan found.
- No daily launch checklist operationalized beyond `soc2.md` guidance.
- No customer security packet found.
- No DPA template found.
- No formal vendor register found.
- No backup restore test evidence found.
- No vulnerability scanning workflow beyond prior local audit note.

Assessment:

- Enough docs for engineering bring-up.
- Not enough for SOC-ready operating evidence.

Recommended next steps:

- Add one-page incident response plan.
- Add pilot launch checklist and ownership.
- Add vendor register and security packet.
- Add access review procedure.
- Add backup restore test record.
- Add CI for tests/lint/security checks.

## Go-Live Blockers For Controlled Beta

Before live candidates, resolve or explicitly accept these risks:

1. Fail closed on backend internal auth in production.
2. Restrict platform interview/team actions with real role/permission checks.
3. Decide scoring posture:
   - allowed: draft rubric scores and draft recommendation for human signoff.
   - avoid for beta: ranking lists and final pass/fail recommendations without signoff.
4. Update candidate/legal copy to match actual beta posture.
5. Strengthen consent evidence fields and preserve consent history/version.
6. Confirm recording egress, webhook, artifact availability, and reviewer playback path end to end.
7. Ensure media/artifact access is private and signed URL based.
8. Add rate limiting/WAF for public platform and candidate join.
9. Define retention/deletion policy and implement operational deletion including S3.
10. Create incident response plan and candidate support/accommodation workflow.

## Evidence Matrix

| Area | Status | Evidence |
|---|---|---|
| Backend health check | Present | `backend/src/server.ts:83`, `docs/RUNBOOK.md:64` |
| Backend auth middleware | Partial | `backend/src/integration/internal-auth.ts:45` fails open if token absent |
| Public backend exposure block | Present in CDK | `infra/lib/infra-stack.ts:217` |
| Candidate invite tokens | Present | `backend/src/invites/tokens.ts:3`, `backend/migrations/002_candidate_invites.sql:3` |
| Candidate join consent gate | Present | `backend/src/invites/routes.ts:291`, `backend/src/consent/repository.ts:11` |
| Consent evidence depth | Gap | `backend/migrations/001_init.sql:14` lacks versions/IP/UA/customer |
| Platform auth | Partial | `platform/app/dashboard/auth.ts:5` domain-based only |
| Role/permission RBAC | Gap | no server-side WorkOS permission check found |
| Recording start | Partial | `backend/src/invites/routes.ts:321`, `backend/src/livekit/egress.ts:54` |
| Webhook verification | Present | `backend/src/livekit/webhooks.ts:156` |
| Private artifact bucket | Present | `infra/lib/infra-stack.ts:495` |
| Artifact upload/finalization | Gap | `docs/RUNBOOK.md:105` |
| Review dashboard real data | Gap | `platform/app/dashboard/demo-data.ts:956` |
| Human signoff primitives | Partial | `review/src/signoff.ts:18` |
| Recommendation gate | Gap | `backend/src/integration/contract.ts:74` returns recommendation even unsigned |
| Audit log table/hash chain | Present primitive | `backend/migrations/001_init.sql:43`, `backend/src/events/repository.ts:50` |
| Audit coverage | Partial | not all sensitive actions audited |
| Retention/deletion policy | Partial | `platform/app/legalPages.ts:51`, no operational schedule |
| DB deletion plan | Partial | `backend/src/db/deletion.ts:17` |
| S3 deletion | Gap | `backend/src/db/deletion.ts:42` only executes DB deletes |
| WAF/rate limit | Gap | no WAF/rate-limit code found |
| Security headers | Gap | `platform/next.config.ts:3` empty |
| Node non-root containers | Gap | `backend/Dockerfile:21`, `platform/Dockerfile:19` |
| Agent non-root container | Present | `agent/Dockerfile:25` |
| DB TLS cert verification | Gap | `infra/lib/infra-stack.ts:935` sets reject unauthorized false |
| CI/CD | Gap | `docs/RUNBOOK.md:107` |

## What Was Not Verified

- Live AWS resources or actual deployed topology.
- Runtime response headers.
- WorkOS tenant settings, role mappings, or signup restrictions.
- Actual production environment variables.
- DNS, TLS, and certificate state.
- Live recording egress behavior.
- S3 bucket contents or access policies outside CDK.
- Vendor DPAs/subprocessor contracts.
- Bias audit, legal review, or employment counsel signoff.
- Backup and restore behavior.
- Operational monitoring/alerting outside code.

## Practical Next Note

The repo is moving in the right direction. The strongest controls are in infrastructure and invite/consent basics. The weakest areas are live product governance around scoring/recommendations, real reviewer access control, artifact lifecycle, retention/deletion operations, and public-edge hardening.

The clean beta position is:

> Puddle conducts structured AI interviews and generates draft, evidence-linked rubric review materials. Human reviewers make final recommendations and employment decisions. Candidate data is invite-gated, consented, privately stored, auditable, and deletable through a defined process.

That position is credible if the gaps above are closed or tightly constrained for the first pilot.
