# Complete Interview Artifacts Verification

Date: 2026-06-10
Branch: `complete-interview-artifacts`

## Local Verification

Backend tests:

```text
corepack pnpm@9.12.0 --filter @puddle/backend test
Test Files 20 passed (20)
Tests 119 passed (119)
```

Agent tests:

```text
cd agent && uv run pytest
138 passed in 0.63s
```

Platform build:

```text
corepack pnpm@9.12.0 --filter @puddle/platform build
Compiled successfully
Finished TypeScript
```

Note: the platform build requires running outside the filesystem sandbox because Turbopack binds local worker ports during production builds.

## Live Smoke Interview

Status: not run from this workspace.

Artifact bucket:

```text
puddle-videoagent-artifacts-851725544921-us-west-1
```

Run a production-like smoke interview with `PUDDLE_RECORDINGS_ENABLED=true`, a candidate camera/mic session of 30-60 seconds, and then verify these keys:

```text
<orgId>/interviews/<sessionId>/media/composite.mp4
<orgId>/interviews/<sessionId>/transcripts/transcript.v1.json
<orgId>/interviews/<sessionId>/assessment/scores.json
<orgId>/interviews/<sessionId>/assessment/integrity_flags.json
<orgId>/interviews/<sessionId>/events/agent_events.jsonl
```

After the live session, verify Postgres:

```sql
select session_id, status, room_name, started_at, ended_at
from sessions
where session_id = '<session-id>';

select kind, status, storage_path, size_bytes, duration_seconds
from recording_artifacts
where session_id = '<session-id>'
order by kind;

select count(*) as transcript_turns
from transcript_turns
where session_id = '<session-id>';

select session_id, script_version, meets_bare_minimum, category_scores, integrity_flags
from assessments
where session_id = '<session-id>';
```

Expected live result:

```text
sessions.status is review_ready after both egress and agent finalization complete.
composite_video, transcript, scores, integrity_flags, and agent_events are available.
transcript_turns count is greater than 0.
assessments has one row for the session.
```

Dashboard URL:

```text
https://app.usepuddle.com/dashboard/interviews/<session-id>
```

Expected dashboard result:

```text
The page renders the real candidate email, real session id, a playable composite video, transcript turns, and score/recommendation state when available.
```
