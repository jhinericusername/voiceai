# Historical Fireflies Dry-Run Verification

Date: 2026-06-15
Mode: dry-run only
Org: org_01KV4FF7KX24B76H7Q57QVB5CT

No production apply was run. The dry-runs did not copy S3 objects and did not write Puddle database rows.

## Recent Missing Range

Filters:

```text
since_date=2026-06-11
until_date=2026-06-13
```

Output:

```text
mode=dry-run
planned_count=16
imported_count=0
skipped_count=0
failed_count=0
copy_count=96
skipped_copy_count=0
db_write_count=0
selected_matches=0
ranked_match_candidates=0
unindexed_recordings=16
```

## Full Historical Inventory

Filters:

```text
none
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
selected_matches=322
ranked_match_candidates=343
unindexed_recordings=16
```
