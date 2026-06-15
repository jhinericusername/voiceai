# Historical Fireflies One-Record Import Verification - 2026-06-15

## Command

Ran one-record production apply with explicit confirmation:

```text
node dist/weave/fireflies/historical-import.js --mode apply --org-id org_01KV4FF7KX24B76H7Q57QVB5CT --limit 1 --confirm-apply
```

## Import Output

```text
mode=apply
planned_count=1
imported_count=1
skipped_count=0
failed_count=0
copy_count=6
skipped_copy_count=0
db_write_count=390
selected_matches=1
ranked_match_candidates=1
unindexed_recordings=0
```

## Imported Session

```text
session_id=hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8
org_id=org_01KV4FF7KX24B76H7Q57QVB5CT
external_source=fireflies
external_id=01KNR0CQ3CVZF8AKQ74P6BEEB8
status=review_ready
match_status=matched
selected_application_id=68a9ded9-15c6-4429-95ed-d22a5d4f19ff
match_candidate_count=1
source_metadata_type=object
```

`source_metadata_type=object` verifies the JSONB metadata is not stringified twice.

## Artifacts

```text
candidate_audio available /org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8/media/candidate_audio.mp3 audio/mpeg
composite_video available /org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8/media/composite.mp4 video/mp4
transcript available /org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8/transcripts/transcript.v1.json application/json
transcript_turns=385
```

## Target S3 Objects

```text
org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8/media/candidate_audio.mp3 5334669
org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8/media/composite.mp4 477225976
org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8/source/fireflies/ingestion-result.json 1621
org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8/source/fireflies/metadata.json 588
org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8/source/fireflies/summary.json 5515
org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8/transcripts/transcript.v1.json 237539
```

## Dashboard Detail Check

Automated authenticated dashboard verification was not completed. The local Chrome extension is installed in Chrome `Profile 1`, while the selected/running Chrome profile is `Profile 16`, so the browser automation session could not claim the signed-in browser.

Manual URL to verify:

```text
https://app.usepuddle.com/dashboard/interviews/hist_fireflies_01KNR0CQ3CVZF8AKQ74P6BEEB8
```

Expected manual checks:

```text
page loads under Weave org membership
video is playable
transcript turns render
source pill says Historical Fireflies import
```

## Safety

Only one recording was applied. Full historical import was not run.
