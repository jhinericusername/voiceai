import type { SqlStatement } from "../consent/repository.js";

export function interviewListStatement(input: { readonly limit: number }): SqlStatement {
  return {
    sql:
      "SELECT s.session_id, s.org_id, s.candidate_email, s.script_version, " +
      "s.status, s.room_name, s.scheduled_at, s.started_at, s.ended_at, " +
      "r.status AS recording_status, r.egress_id, " +
      "a.category_scores, a.meets_bare_minimum, a.integrity_flags, " +
      "a.reviewer_email, a.signed_off_at " +
      "FROM sessions s " +
      "LEFT JOIN recordings r ON r.session_id = s.session_id " +
      "LEFT JOIN assessments a ON a.session_id = s.session_id " +
      "ORDER BY COALESCE(s.started_at, s.scheduled_at, s.created_at) DESC " +
      "LIMIT $1",
    params: [input.limit],
  };
}

export function interviewDetailStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT s.session_id, s.org_id, s.candidate_email, s.script_version, " +
      "s.status, s.room_name, s.scheduled_at, s.started_at, s.ended_at, " +
      "r.status AS recording_status, r.egress_id, r.error_message, " +
      "a.category_scores, a.meets_bare_minimum, a.integrity_flags, " +
      "a.reviewer_email, a.signed_off_at, " +
      "COALESCE(json_agg(DISTINCT jsonb_build_object(" +
      "'kind', ra.kind, 'status', ra.status, 'storagePath', ra.storage_path, " +
      "'contentType', ra.content_type, 'sizeBytes', ra.size_bytes, " +
      "'durationSeconds', ra.duration_seconds" +
      ")) FILTER (WHERE ra.kind IS NOT NULL), '[]'::json) AS artifacts, " +
      "COALESCE(json_agg(DISTINCT jsonb_build_object(" +
      "'turnIndex', tt.turn_index, 'speaker', tt.speaker, 'questionId', tt.question_id, " +
      "'text', tt.text, 'occurredAt', tt.occurred_at, 'offsetMs', tt.offset_ms" +
      ")) FILTER (WHERE tt.turn_index IS NOT NULL), '[]'::json) AS transcript_turns " +
      "FROM sessions s " +
      "LEFT JOIN recordings r ON r.session_id = s.session_id " +
      "LEFT JOIN assessments a ON a.session_id = s.session_id " +
      "LEFT JOIN recording_artifacts ra ON ra.session_id = s.session_id " +
      "LEFT JOIN transcript_turns tt ON tt.session_id = s.session_id " +
      "WHERE s.session_id = $1 " +
      "GROUP BY s.session_id, r.session_id, a.session_id",
    params: [sessionId],
  };
}
