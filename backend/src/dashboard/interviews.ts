import type { SqlStatement } from "../consent/repository.js";

export function interviewListStatement(input: {
  readonly limit: number;
  readonly orgId: string;
}): SqlStatement {
  return {
    sql:
      "SELECT s.session_id, s.org_id, s.candidate_email, s.script_version, " +
      "s.status, s.room_name, s.scheduled_at, s.started_at, s.ended_at, " +
      "s.external_source, s.external_id, s.source_metadata, " +
      "r.status AS recording_status, r.egress_id, " +
      "a.category_scores, a.meets_bare_minimum, a.integrity_flags, " +
      "a.reviewer_email, a.signed_off_at " +
      "FROM sessions s " +
      "LEFT JOIN recordings r ON r.session_id = s.session_id " +
      "LEFT JOIN assessments a ON a.session_id = s.session_id " +
      "WHERE s.org_id = $2 " +
      "ORDER BY COALESCE(s.started_at, s.scheduled_at, s.created_at) DESC " +
      "LIMIT $1",
    params: [input.limit, input.orgId],
  };
}

export function interviewDetailStatement(sessionId: string, orgId: string): SqlStatement {
  return {
    sql:
      "SELECT s.session_id, s.org_id, s.candidate_email, s.script_version, " +
      "s.status, s.room_name, s.scheduled_at, s.started_at, s.ended_at, " +
      "s.external_source, s.external_id, s.source_metadata, " +
      "r.status AS recording_status, r.egress_id, r.error_message, " +
      "a.category_scores, a.meets_bare_minimum, a.integrity_flags, " +
      "a.reviewer_email, a.signed_off_at, " +
      "COALESCE(artifacts.items, '[]'::json) AS artifacts, " +
      "COALESCE(transcript_turns.items, '[]'::json) AS transcript_turns " +
      "FROM sessions s " +
      "LEFT JOIN recordings r ON r.session_id = s.session_id " +
      "LEFT JOIN assessments a ON a.session_id = s.session_id " +
      "LEFT JOIN LATERAL (" +
      "SELECT json_agg(json_build_object(" +
      "'kind', ordered.kind, 'status', ordered.status, " +
      "'storagePath', ordered.storage_path, 'contentType', ordered.content_type, " +
      "'sizeBytes', ordered.size_bytes, 'durationSeconds', ordered.duration_seconds" +
      ") ORDER BY ordered.kind) AS items " +
      "FROM (SELECT kind, status, storage_path, content_type, size_bytes, duration_seconds " +
      "FROM recording_artifacts WHERE session_id = s.session_id ORDER BY kind) ordered" +
      ") artifacts ON true " +
      "LEFT JOIN LATERAL (" +
      "SELECT json_agg(json_build_object(" +
      "'turnIndex', ordered.turn_index, 'speaker', ordered.speaker, " +
      "'questionId', ordered.question_id, 'text', ordered.text, " +
      "'occurredAt', ordered.occurred_at, 'offsetMs', ordered.offset_ms" +
      ") ORDER BY ordered.turn_index) AS items " +
      "FROM (SELECT turn_index, speaker, question_id, text, occurred_at, offset_ms " +
      "FROM transcript_turns WHERE session_id = s.session_id ORDER BY turn_index) ordered" +
      ") transcript_turns ON true " +
      "WHERE s.session_id = $1 AND s.org_id = $2",
    params: [sessionId, orgId],
  };
}
