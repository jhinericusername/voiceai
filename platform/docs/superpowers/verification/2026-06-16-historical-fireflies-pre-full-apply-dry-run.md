# Historical Fireflies Pre-Full-Apply Dry-Run Verification

Date: 2026-06-16
Mode: dry-run only
Org: org_01KV4FF7KX24B76H7Q57QVB5CT

No production apply was run. These dry-runs did not copy S3 objects and did not write Puddle database rows.

## Current Source Inventory

Read-only S3 inventory for `weave-fireflies-prod-851725544921-us-west-2/raw/fireflies/`:

```text
object_count=2075
recording_folders=346
distinct_transcript_ids=346
transcript_ids_with_multiple_folders=0
duplicate_folder_occurrences=0
missing_video=1
missing_audio=0
missing_transcript=0
first_date=2026-04-09
last_date=2026-06-16
```

The current source bucket has 8 more recordings than the older 338-record cutoff because it now includes recordings from 2026-06-15 and 2026-06-16.

## Current Full Source Dry-Run

Filters:

```text
none
batch_size=1000
```

Output:

```text
mode=dry-run
planned_count=346
imported_count=0
skipped_count=0
failed_count=0
copy_count=2075
skipped_copy_count=0
db_write_count=0
selected_matches=287
ranked_match_candidates=343
unindexed_recordings=24
```

## Original Historical Cutoff Dry-Run

Filters:

```text
until_date=2026-06-13
batch_size=1000
```

Output:

```text
mode=dry-run
planned_count=338
imported_count=0
skipped_count=0
failed_count=0
copy_count=2027
skipped_copy_count=0
db_write_count=0
selected_matches=287
ranked_match_candidates=343
unindexed_recordings=16
```

## Weave Match Aggregate

Read-only aggregate from the source Weave database:

```text
weave_fireflies_recordings=322
selected_application_rows=287
selected_candidate_rows=287
matched_status_rows=287
unmatched_status_rows=18
ambiguous_status_rows=17
ranked_match_candidate_rows=343
```

`selected_matches` means rows with a selected Ashby application. The remaining Weave rows are preserved as unmatched or ambiguous metadata rather than forced into a selected application.
