# Fireflies Interview Flow Extraction Design

## Goal

Create a local, auditable pipeline that analyzes historical Fireflies interview transcripts and produces a data flowchart of Prakul Singh's actual interview question behavior.

The pipeline will run the user's per-transcript extraction prompt first, validate each JSON result, then aggregate all successful extractions into a global interview-flow JSON, Mermaid flowchart, and short Markdown summary.

## Current Context

- Historical Fireflies artifacts live in `s3://weave-fireflies-prod-851725544921-us-west-2/raw/fireflies/`.
- The local AWS credentials resolve to account `851725544921` and can list the Fireflies prefix.
- The CDK stack already imports the historical Fireflies bucket and grants the backend task role read access to `raw/fireflies/*`, including KMS decrypt.
- Existing Fireflies reconciliation code lives under `backend/src/weave/fireflies/`.
- Claude Fable 5 requires Bedrock `provider_data_share`, which would allow provider sharing and 30-day retention for prompts and outputs. This is not acceptable for this personal interview dataset.
- Claude Opus 4.8 works through Bedrock without enabling `provider_data_share`.

## Model Choice

Use Amazon Bedrock Converse with:

- Region: `us-east-1`
- Model ID: `us.anthropic.claude-opus-4-8`

Opus 4.8 only supports inference profiles in this account. A minimal `Converse` call succeeded with the inference profile. The model rejects the `temperature` inference parameter, so requests will use `maxTokens` only.

## Privacy Constraints

- Do not enable Bedrock `provider_data_share`.
- Do not use Claude Fable 5 for this dataset.
- Do not commit raw transcripts, extracted per-transcript JSON, aggregate JSON, Mermaid output, run logs, or reports.
- Write analysis outputs only to a gitignored local artifact directory.
- Keep prompts and outputs out of chat unless the user explicitly asks for a redacted excerpt.

## Output Location

Default local output directory:

```text
artifacts/interview-flow/
```

The implementation must ensure this directory is ignored by git before writing transcript-derived artifacts.

Expected output structure:

```text
artifacts/interview-flow/
  manifest.json
  inputs/
    interview_001.json
    interview_002.json
  extractions/
    interview_001.json
    interview_002.json
  aggregate/
    interview-flow.json
    interview-flow.mmd
    summary.md
  run-log.jsonl
```

## Transcript Selection

The first implementation will analyze 50 transcripts by default.

Selection rules:

- List transcript folders from the Fireflies S3 prefix.
- Include folders with a readable `transcript.json`.
- Sort deterministically by S3 key.
- Assign stable IDs in sorted order: `interview_001`, `interview_002`, through `interview_050`.
- Preserve the source S3 bucket/key in `manifest.json` for traceability.
- Candidate name should default to `null`. Only populate it when Fireflies metadata provides an explicit candidate/person field; do not infer it from a title or transcript text.

The implementation should support a configurable transcript limit and an optional explicit manifest file for repeat runs.

## Data Flow

1. Discover Fireflies transcript JSON objects from S3.
2. Build or read a stable manifest of selected transcripts.
3. Download each selected `transcript.json` into memory or a local ignored input artifact.
4. Normalize transcript content into readable speaker-labeled text while preserving available timestamps.
5. Wrap each transcript as:

   ```json
   {
     "transcript_id": "interview_001",
     "candidate_name": null,
     "transcript_text": "..."
   }
   ```

6. Send each transcript to Bedrock Opus 4.8 with the user's per-transcript extraction prompt.
7. Parse and validate JSON output.
8. Save one extraction JSON per transcript.
9. Aggregate validated extraction JSONs with the user's aggregation prompt.
10. Parse and validate aggregate JSON.
11. Write aggregate JSON, Mermaid flowchart, and Markdown summary.

## Prompt Handling

The extraction and aggregation prompts are treated as versioned local prompt templates.

Each Bedrock call should include:

- A system or user instruction requiring valid JSON only.
- The user's full schema prompt.
- The prepared transcript wrapper or extraction bundle.

The implementation must not start with a single 50-transcript mega-prompt. Per-transcript extraction is mandatory before aggregation.

## Validation And Retry

Per-transcript responses must be valid JSON objects with at least:

- `interview_metadata`
- `question_events`
- `observed_patterns`
- `flowchart_edges`
- `quality_notes`

Aggregate responses must be valid JSON objects with at least:

- `global_interview_flow`
- `canonical_questions`
- `follow_up_logic`
- `flowchart`
- `mermaid_flowchart`
- `summary`

If a model response is invalid JSON:

- Retry once with a repair prompt containing only the invalid response and the target schema reminder.
- If repair fails, mark that transcript as failed in `run-log.jsonl` and continue unless a strict mode is enabled.

The aggregation step should run only over successful per-transcript extractions.

## Resume Behavior

The pipeline must be resumable:

- Reuse existing `manifest.json` unless `--refresh-manifest` is provided.
- Skip an extraction if `extractions/<transcript_id>.json` already exists and validates.
- Re-run failed or invalid extractions when requested.
- Reuse aggregate output only when explicitly requested; default aggregation should regenerate from current validated extractions.

## Implementation Shape

Add a focused TypeScript CLI under the existing backend Fireflies area:

```text
backend/src/weave/fireflies/interview-flow.ts
```

Add package scripts:

```text
pnpm --filter @puddle/backend interview-flow:extract
pnpm --filter @puddle/backend interview-flow:aggregate
pnpm --filter @puddle/backend interview-flow:run
```

Preferred AWS integration:

- Use AWS SDK v3 packages for S3 and Bedrock Runtime.
- Keep model ID, region, S3 bucket, S3 prefix, limit, and output directory configurable through CLI flags or environment variables.

If dependency installation is blocked, a temporary AWS CLI-backed implementation is acceptable, but the maintainable path is SDK-based.

## Error Handling

- S3 list/get failures should include bucket, key, and AWS error code in `run-log.jsonl`, not raw transcript text.
- Bedrock failures should include model ID, transcript ID, request attempt number, and AWS error code/message.
- JSON validation failures should include the transcript ID and a short parse/validation reason.
- The command should exit nonzero if no transcripts are processed, all extractions fail, or aggregation fails.

## Testing

Focused tests should cover:

- Stable transcript ID assignment from sorted S3 keys.
- Fireflies transcript JSON to speaker-labeled text conversion.
- Prompt rendering includes transcript wrapper and does not omit `transcript_id`.
- JSON parsing extracts valid JSON and rejects malformed or schema-incomplete output.
- Resume behavior skips valid existing extraction files.
- Mermaid output is copied from aggregate JSON to `.mmd`.

Network and paid Bedrock calls should not run in unit tests. Use mocked S3 and Bedrock clients.

## Execution Gate

Before running against 50 real transcripts:

1. Run a one-transcript smoke test.
2. Confirm the extraction JSON is valid and structurally useful.
3. Run a three-transcript smoke test.
4. Only then run the full 50-transcript extraction and aggregation.

## Open Decisions

- Default selection is the first 50 sorted transcript folders. If the user wants a specific subset, they should provide a manifest or filtering rule before the full run.
- The first implementation will not write results to the database.
- The first implementation will not run as an ECS task; CDK-managed execution can be added after the local workflow is proven.
