# Weave Grading Evaluation Inventory Verification

Date: 2026-06-16
Mode: dry-run only
Org: org_01KV4FF7KX24B76H7Q57QVB5CT

No model scoring was run. No database writes were run. No transcript text, candidate emails, or secret values were printed or recorded.

## Setup

Local `.env.local` did not contain the split `DATABASE_*` or `WEAVE_DATABASE_*` variables required by the backend Postgres pool.

To verify live inventory, an SSM port-forward was opened to the dev RDS endpoint from the existing stack outputs:

```text
stack=Puddle-VideoAgent-Infra
environment=dev
local_port=15433
database_name=puddle
weave_database_name=weave
```

Puddle and Weave DB credentials were read from AWS Secrets Manager inside the dry-run process and passed as environment variables. Secret values were not printed.

## Command

```bash
pnpm --filter @puddle/backend grading:evaluate -- \
  --organization-id org_01KV4FF7KX24B76H7Q57QVB5CT \
  --dry-run \
  --limit 25
```

Result:

```json
{
  "mode": "dry-run",
  "inventory": {
    "requestedLimit": 25,
    "loadedPuddleLabels": 0,
    "loadedHistoricalLinks": 25,
    "weaveEvaluationIds": 25,
    "weaveLabelsLoaded": 25,
    "sessionsWithTranscripts": 24,
    "evaluatableCases": 24,
    "skipped": {
      "missingTranscript": 1,
      "missingScores": 0,
      "missingWeaveLabel": 0,
      "missingAshbyJobId": 0
    }
  }
}
```

## Larger Read-Only Inventory

```bash
pnpm --filter @puddle/backend grading:evaluate -- \
  --organization-id org_01KV4FF7KX24B76H7Q57QVB5CT \
  --dry-run \
  --limit 100
```

Result:

```json
{
  "mode": "dry-run",
  "inventory": {
    "requestedLimit": 100,
    "loadedPuddleLabels": 0,
    "loadedHistoricalLinks": 100,
    "weaveEvaluationIds": 96,
    "weaveLabelsLoaded": 96,
    "sessionsWithTranscripts": 96,
    "evaluatableCases": 96,
    "skipped": {
      "missingTranscript": 4,
      "missingScores": 0,
      "missingWeaveLabel": 0,
      "missingAshbyJobId": 0
    }
  }
}
```

## Notes

- The harness sees Weave `candidate_evaluations` through historical Fireflies/Puddle session links.
- The current Puddle-side `ashby_candidate_scores` path returned 0 rows for this org in the dry-run; available labels came from Weave candidate evaluations.
- At `--limit 100`, 96 cases were evaluatable immediately and 4 were skipped for missing transcripts.
- Dry-run output remained transcript-safe by default.
