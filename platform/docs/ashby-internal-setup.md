# Internal Ashby Setup

## Backend config

Generate production secret values with:

```bash
openssl rand -hex 32
```

Set these values in the platform runtime and backend runtime as appropriate:

```bash
PUDDLE_BACKEND_BASE_URL=https://api.usepuddle.com
PUDDLE_BACKEND_INTERNAL_TOKEN=local-dev-platform-backend-token-2026-06-10
PUDDLE_ASHBY_WEBHOOK_SECRET=local-dev-ashby-webhook-secret-2026-06-10
PUDDLE_INTEGRATION_SECRET_KEY=local-dev-integration-secret-2026-06-10
```

## Create the company integration

Export the Ashby values before creating the integration:

```bash
export ASHBY_API_KEY="ashby_api_key_here"
export ASHBY_JOB_ID="ashby_job_id_here"
```

Create the integration:

```bash
curl -sS -X POST "$PUDDLE_BACKEND_BASE_URL/integrations/ashby/setup" \
  -H "Authorization: Bearer $PUDDLE_BACKEND_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"emailDomain\": \"usepuddle.com\",
    \"organizationId\": null,
    \"ashbyApiKey\": \"$ASHBY_API_KEY\",
    \"selectedJobIds\": [\"$ASHBY_JOB_ID\"]
  }"
```

Save the returned `integrationId`; it is needed for support and follow-up debugging.

## Create Ashby webhooks

Create an Ashby webhook with this request URL:

```text
https://platform.usepuddle.com/api/ashby/webhook?companyDomain=usepuddle.com
```

Use the exact value of `PUDDLE_ASHBY_WEBHOOK_SECRET` as the Ashby secret token.

Enable these webhook actions:

- `ping`
- `applicationSubmit`
- `applicationUpdate`
- `candidateStageChange`
- `candidateDelete`
- `candidateMerge`
- `candidateHire`

## Run initial active application sync

Run an initial sync for active applications:

```bash
curl -sS -X POST "$PUDDLE_BACKEND_BASE_URL/integrations/ashby/sync-active-applications" \
  -H "Authorization: Bearer $PUDDLE_BACKEND_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "emailDomain": "usepuddle.com", "organizationId": null }'
```

## Verify

1. Open `/dashboard`.
2. Confirm same-domain users see recent screens or the empty screens state instead of setup.
3. Open a role.
4. Open the `Score` tab.
5. Search for an active Ashby candidate.
6. Save a scorecard.
7. Refresh `/dashboard` and confirm the score appears under recent screens.
