# Ashby Self-Serve Setup

## Runtime prerequisites

The backend service and backend migration task require:

```text
PUDDLE_INTEGRATION_SECRET_KEY
```

This value comes from AWS Secrets Manager at:

```text
/puddle-videoagent/integrations/encryption-key
```

The CDK stack also emits this secret name as the
`IntegrationEncryptionKeySecretName` output for environment-specific lookups.

The platform does not need `PUDDLE_ASHBY_WEBHOOK_SECRET`.

Ashby setup actions require a privileged WorkOS role or permission. When
WorkOS roles and permissions are not configured yet, set the bootstrap fallback
below to a comma-separated list of exact admin email addresses:

```text
PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS=admin@example.com,owner@example.com
```

For `scripts/deploy-platform.sh` platform container deployments, keep the value
in `.env.local` or export `PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS`; the script
passes it to CDK through the child process environment. Manual CDK runs may use
the `platformAshbyOnboardingAdminEmails` context key.

## Customer setup

1. Sign in to `/dashboard` with an allowed company email domain. The signed-in
   user must be a workspace admin/owner, have an Ashby setup permission, or be
   listed in `PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS`.
2. Paste an Ashby API key.
3. Select one or more Ashby jobs.
4. Copy the generated webhook URL and webhook secret shown after saving jobs.
   The webhook secret is shown only during setup and is not re-exposed after
   reload. Store it while creating the Ashby webhook. If it is lost before
   configuration, re-run the job save/setup step or use the later regeneration
   flow when available.
5. In Ashby, create webhooks for:
   - `ping`
   - `applicationSubmit`
   - `applicationUpdate`
   - `candidateStageChange`
   - `candidateDelete`
   - `candidateMerge`
   - `candidateHire`
6. Use the generated Puddle webhook URL as the request URL.
7. Use the generated Puddle webhook secret as the Ashby secret token.
8. Send or test the `ping` webhook from Ashby, then check the connection in
   Puddle from `/dashboard`. If you refreshed after copying the values, use the
   pending-webhook panel's Check webhook connection action.
9. Run initial active candidate sync from the Puddle dashboard.
10. After the sync completes, `/dashboard` shows the Recent screens view. It
    may show saved scorecards or an empty state if no scorecards exist yet.

## Local testing

Use `pnpm dev:connected` to run localhost against the deployed dev backend.
Use a public HTTPS tunnel only when testing real Ashby webhook delivery against
localhost. When using a tunnel, set
`PUDDLE_PUBLIC_BASE_URL=https://<tunnel-host>` before saving jobs so the
generated webhook setup values use the public tunnel URL instead of
`NEXT_PUBLIC_SITE_URL` or `http://localhost:3000`.
