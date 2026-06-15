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

## Production public URLs

Production platform traffic must use HTTPS. Set `PUDDLE_PUBLIC_BASE_URL`
or `NEXT_PUBLIC_SITE_URL` to the production public app origin, for example
`https://app.usepuddle.com`.

Do not save Ashby jobs in production with a localhost public base URL. The
backend generates the Ashby webhook URL from the platform-provided public base
URL, so production webhook URLs must point to the production public domain and
not `localhost` or `127.0.0.1`.

## Internal transport decision

The current platform-to-backend hop uses private VPC HTTP, security groups, and
the `PUDDLE_BACKEND_INTERNAL_TOKEN` bearer token. This is acceptable for the
current early production posture only if the security groups remain tight and
the internal token is present in production.

Do not describe the system as encrypted in transit on every hop while this
private VPC HTTP hop remains. To make that claim, add backend HTTPS or an
internal TLS/mTLS listener for platform-to-backend traffic.

## Secret decryption allowlist

Ashby API keys and webhook secrets stay server-side. The backend may decrypt
them only for these code paths:

- `selected-job-validation`: decrypt the stored Ashby API key to re-check that
  selected jobs are still open before saving job selection.
- `active-application-sync`: decrypt the stored Ashby API key to call Ashby
  while syncing active applications.
- `webhook-setup-display`: decrypt the generated webhook secret only to show it
  to an admin during setup or reconnect.
- `webhook-signature-verification`: decrypt the webhook secret to verify an
  incoming Ashby webhook signature.

Do not add new decrypt points without updating the backend allowlist tests and
this runbook.

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
   configuration, re-run the job save/setup step.
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

## Reconnect and rotation

Workspace admins and owners can use the Reconnect Ashby panel on `/dashboard`
after setup is complete. Validating a replacement Ashby API key starts the same
server-side flow as initial setup: the backend validates the key, stores the
new encrypted key, returns new webhook setup values, and requires Ashby to send
a new verified ping.

Replacing the key resets webhook verification. Update the Ashby webhook with
the new URL and secret, send a ping, then run sync again. Treat this as the
standard key rotation path. The backend audit trail records who replaced the
key, saved job selection, and ran active-application sync.

## Local testing

Use `pnpm dev:connected` to run localhost against the deployed dev backend.
Use a public HTTPS tunnel only when testing real Ashby webhook delivery against
localhost. When using a tunnel, set
`PUDDLE_PUBLIC_BASE_URL=https://<tunnel-host>` before saving jobs so the
generated webhook setup values use the public tunnel URL instead of
`NEXT_PUBLIC_SITE_URL` or `http://localhost:3000`.
