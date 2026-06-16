# Historical Fireflies Full Import Verification

Date: 2026-06-16
Mode: apply
Org: org_01KV4FF7KX24B76H7Q57QVB5CT
Scope: original historical cutoff through 2026-06-13

The confirmed production apply imported the original 338 historical Fireflies recordings into Puddle. No transcript text or secret values are included in this note.

## Apply Scope

The current S3 source has 346 recordings through 2026-06-16. The confirmed apply scope was the original historical cutoff:

```text
until_date=2026-06-13
source_transcript_ids=338
```

## Chunked Apply Output

The first serial full apply was stopped before database writes because it was still in the S3 copy phase. A read-only database check after stopping it showed only the previously imported one-record batch.

The confirmed 338-record apply was then run in non-overlapping date chunks. All chunks completed with `failed_count=0`:

```text
2026-04-09..2026-04-30 planned_count=47 imported_count=47 failed_count=0 copy_count=215 skipped_copy_count=67 db_write_count=9636 selected_matches=45 ranked_match_candidates=51 unindexed_recordings=0
2026-05-01..2026-05-08 planned_count=64 imported_count=64 failed_count=0 copy_count=384 skipped_copy_count=0 db_write_count=12395 selected_matches=48 ranked_match_candidates=73 unindexed_recordings=0
2026-05-11..2026-05-20 planned_count=68 imported_count=68 failed_count=0 copy_count=408 skipped_copy_count=0 db_write_count=11809 selected_matches=63 ranked_match_candidates=75 unindexed_recordings=0
2026-05-21..2026-05-29 planned_count=72 imported_count=72 failed_count=0 copy_count=432 skipped_copy_count=0 db_write_count=11373 selected_matches=68 ranked_match_candidates=77 unindexed_recordings=0
2026-06-01..2026-06-08 planned_count=53 imported_count=53 failed_count=0 copy_count=317 skipped_copy_count=0 db_write_count=10096 selected_matches=50 ranked_match_candidates=51 unindexed_recordings=0
2026-06-09..2026-06-13 planned_count=34 imported_count=34 failed_count=0 copy_count=204 skipped_copy_count=0 db_write_count=6113 selected_matches=13 ranked_match_candidates=16 unindexed_recordings=16
```

The one earlier one-record apply remains represented in the final 338 session count via idempotent upsert/reconciliation.

## Puddle Database Counts

Read-only verification query:

```text
imported_sessions=338
recordings=338
transcript_turns=59733
selected_application_sessions=287
sessions_with_match_candidates=304
unindexed_sessions=16
jsonb_object_sessions=338
```

`jsonb_object_sessions=338` verifies `source_metadata` is stored as JSONB objects, not stringified JSON.

## Artifact Counts

Read-only verification query:

```text
candidate_audio available=338
composite_video available=337
transcript available=338
```

The one missing video matches the known source inventory condition.

## Source/Target Parity

Read-only S3 plus Puddle DB parity check:

```text
source_transcript_ids_through_2026_06_13=338
puddle_fireflies_transcript_ids=338
missing_in_puddle=0
extra_in_puddle=0
target_objects_under_org_interviews=2033
```

The target object count includes 2027 objects from the current imported layout plus 6 leftover objects from the earlier one-record import path. No copied S3 objects were deleted.

## Match Status Breakdown

Read-only Puddle DB breakdown:

```text
matched count=287 selected_applications=287 with_ranked_candidates=287
ambiguous count=17 selected_applications=0 with_ranked_candidates=17
unmatched count=18 selected_applications=0 with_ranked_candidates=0
unindexed count=16 selected_applications=0 with_ranked_candidates=0
```

Remaining application reconciliation work:

```text
total_without_selected_application=51
ambiguous_with_ranked_candidates=17
unmatched_without_candidates=18
unindexed_s3_only=16
```
