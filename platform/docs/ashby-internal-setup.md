# Internal Ashby Setup

## Backend config

Generate production secret values with:

```bash
openssl rand -hex 32
```

Set the runtime values explicitly:

| Variable | Runtime | Notes |
| --- | --- | --- |
| `PUDDLE_BACKEND_BASE_URL` | Platform ops shell, platform runtime | Use the backend URL that the platform can reach. In AWS this is the backend load balancer URL from infrastructure output; for local development use `http://localhost:8080`. Do not assume `api.usepuddle.com` exists unless that DNS record has been created. |
| `PUDDLE_BACKEND_INTERNAL_TOKEN` | Platform ops shell, platform runtime, backend runtime | Shared bearer token for internal backend calls. |
| `PUDDLE_ASHBY_WEBHOOK_SECRET` | Platform runtime, Ashby webhook settings | Shared secret Ashby sends to the platform webhook receiver. |
| `PUDDLE_INTEGRATION_SECRET_KEY` | Backend runtime | Encrypts the stored Ashby API key. |

Use generated values for secrets; do not reuse these placeholders:

```bash
PUDDLE_BACKEND_BASE_URL="<backend-base-url>"
PUDDLE_BACKEND_INTERNAL_TOKEN="<generated-internal-token>"
PUDDLE_ASHBY_WEBHOOK_SECRET="<generated-webhook-secret>"
PUDDLE_INTEGRATION_SECRET_KEY="<generated-integration-secret>"
```

## Create the company integration

Export the Ashby values before creating the integration:

```bash
set -u
: "${PUDDLE_BACKEND_BASE_URL:?Set PUDDLE_BACKEND_BASE_URL first}"
: "${PUDDLE_BACKEND_INTERNAL_TOKEN:?Set PUDDLE_BACKEND_INTERNAL_TOKEN first}"
export ASHBY_API_KEY="ashby_api_key_here"
export ASHBY_JOB_ID="ashby_job_id_here"
```

Create the integration:

```bash
curl --fail-with-body -sS -X POST "$PUDDLE_BACKEND_BASE_URL/integrations/ashby/setup" \
  -H "Authorization: Bearer $PUDDLE_BACKEND_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<JSON
{
  "emailDomain": "usepuddle.com",
  "organizationId": null,
  "ashbyApiKey": "$ASHBY_API_KEY",
  "selectedJobIds": ["$ASHBY_JOB_ID"]
}
JSON
```

Save the returned `integrationId`; it is needed for support and follow-up debugging.

## Create Ashby webhooks

Create an Ashby webhook with this request URL:

```text
https://app.usepuddle.com/api/ashby/webhook?companyDomain=usepuddle.com
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
curl --fail-with-body -sS -X POST "$PUDDLE_BACKEND_BASE_URL/integrations/ashby/sync-active-applications" \
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
