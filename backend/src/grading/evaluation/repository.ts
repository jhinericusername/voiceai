export interface SqlStatement {
  readonly text: string;
  readonly values: readonly unknown[];
}

const DEFAULT_LIMIT = 25;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

export function puddleScoredSessionLabelsStatement(input: {
  readonly organizationId: string;
  readonly ashbyJobId?: string | null;
  readonly limit: number;
}): SqlStatement {
  const values: unknown[] = [input.organizationId];
  const jobId = optionalText(input.ashbyJobId);
  const jobFilter = jobId ? `AND a.job_id = ${pushValue(values, jobId)} ` : "";
  const limitPlaceholder = pushValue(values, safeLimit(input.limit));

  return {
    text:
      "WITH linked AS (" +
      "SELECT s.session_id, s.org_id AS organization_id, s.external_source, s.source_metadata, " +
      "COALESCE(" +
      "NULLIF(s.source_metadata #>> '{ashby,selected,applicationId}', ''), " +
      "NULLIF(s.source_metadata #>> '{ashby,selected,ashbyApplicationId}', ''), " +
      "NULLIF(s.source_metadata #>> '{ashby,applicationId}', ''), " +
      "NULLIF(s.source_metadata #>> '{ashby,application_id}', '')" +
      ") AS ashby_application_id " +
      "FROM sessions s " +
      "WHERE s.org_id = $1" +
      ") " +
      "SELECT linked.session_id, linked.organization_id, a.candidate_name, " +
      "a.candidate_id AS ashby_candidate_id, a.application_id AS ashby_application_id, " +
      "a.job_id AS ashby_job_id, sc.score_id AS label_id, " +
      "sc.problem_solving AS problem_solving, sc.agency AS agency, " +
      "sc.competitiveness AS competitiveness, sc.curiosity AS curious, " +
      "sc.total_score, sc.comments, 'puddle_ashby_score' AS source, " +
      "jsonb_build_object(" +
      "'scoreId', sc.score_id, " +
      "'roleId', sc.role_id, " +
      "'scoreUpdatedAt', sc.updated_at, " +
      "'sessionExternalSource', linked.external_source" +
      ") AS source_metadata " +
      "FROM linked " +
      "JOIN ashby_company_integrations i ON i.organization_id = linked.organization_id " +
      "JOIN ashby_applications a " +
      "ON a.integration_id = i.integration_id AND a.application_id = linked.ashby_application_id " +
      "JOIN ashby_candidate_scores sc " +
      "ON sc.integration_id = a.integration_id AND sc.application_id = a.application_id " +
      "WHERE linked.ashby_application_id IS NOT NULL " +
      jobFilter +
      "ORDER BY sc.updated_at DESC, linked.session_id ASC " +
      `LIMIT ${limitPlaceholder}`,
    values,
  };
}

export function historicalSessionEvaluationLinksStatement(input: {
  readonly organizationId: string;
  readonly ashbyJobId?: string | null;
  readonly limit: number;
}): SqlStatement {
  const values: unknown[] = [input.organizationId];
  const jobId = optionalText(input.ashbyJobId);
  const jobFilter = jobId ? `AND ashby_job_id = ${pushValue(values, jobId)} ` : "";
  const limitPlaceholder = pushValue(values, safeLimit(input.limit));

  return {
    text:
      "WITH base AS (" +
      "SELECT s.session_id, s.org_id AS organization_id, " +
      "NULLIF(s.source_metadata #>> '{ashby,selected,candidateName}', '') AS candidate_name, " +
      "s.external_id, s.source_metadata, " +
      "jsonb_path_query_first(" +
      "s.source_metadata, '$.ashby.matchCandidates[*] ? (@.candidateEvaluationId != null || @.candidate_evaluation_id != null)'" +
      ") AS matched_candidate " +
      "FROM sessions s " +
      "WHERE s.org_id = $1 AND s.external_source = 'fireflies'" +
      "), linked AS (" +
      "SELECT session_id, organization_id, candidate_name, external_id, " +
      "COALESCE(" +
      "NULLIF(source_metadata #>> '{ashby,selected,applicationId}', ''), " +
      "NULLIF(source_metadata #>> '{ashby,selected,ashbyApplicationId}', ''), " +
      "NULLIF(source_metadata #>> '{ashby,selected,application_id}', ''), " +
      "NULLIF(source_metadata #>> '{ashby,applicationId}', ''), " +
      "NULLIF(source_metadata #>> '{ashby_application_id}', ''), " +
      "NULLIF(matched_candidate ->> 'applicationId', ''), " +
      "NULLIF(matched_candidate ->> 'ashbyApplicationId', ''), " +
      "NULLIF(matched_candidate ->> 'application_id', '')" +
      ") AS ashby_application_id, " +
      "COALESCE(" +
      "NULLIF(source_metadata #>> '{ashby,selected,jobId}', ''), " +
      "NULLIF(source_metadata #>> '{ashby,selected,ashbyJobId}', ''), " +
      "NULLIF(source_metadata #>> '{ashby,selected,ashby_job_id}', ''), " +
      "NULLIF(source_metadata #>> '{ashby,jobId}', ''), " +
      "NULLIF(source_metadata #>> '{ashby_job_id}', ''), " +
      "NULLIF(matched_candidate ->> 'jobId', ''), " +
      "NULLIF(matched_candidate ->> 'ashbyJobId', ''), " +
      "NULLIF(matched_candidate ->> 'job_id', '')" +
      ") AS ashby_job_id, " +
      "COALESCE(" +
      "NULLIF(source_metadata #>> '{ashby,selected,candidateEvaluationId}', ''), " +
      "NULLIF(source_metadata #>> '{ashby,selected,candidate_evaluation_id}', ''), " +
      "NULLIF(source_metadata #>> '{candidateEvaluationId}', ''), " +
      "NULLIF(source_metadata #>> '{candidate_evaluation_id}', ''), " +
      "NULLIF(source_metadata #>> '{fireflies,candidate_evaluation_id}', ''), " +
      "NULLIF(matched_candidate ->> 'candidateEvaluationId', ''), " +
      "NULLIF(matched_candidate ->> 'candidate_evaluation_id', '')" +
      ") AS candidate_evaluation_id, " +
      "jsonb_build_object(" +
      "'externalId', external_id, " +
      "'externalSource', 'fireflies', " +
      "'matchStatus', source_metadata #>> '{fireflies,matchStatus}', " +
      "'selectedApplicationId', COALESCE(source_metadata #>> '{ashby,selected,applicationId}', matched_candidate ->> 'applicationId'), " +
      "'selectedJobId', COALESCE(source_metadata #>> '{ashby,selected,jobId}', matched_candidate ->> 'jobId'), " +
      "'candidateEvaluationId', COALESCE(source_metadata #>> '{ashby,selected,candidateEvaluationId}', matched_candidate ->> 'candidateEvaluationId')" +
      ") AS source_metadata " +
      "FROM base" +
      ") " +
      "SELECT session_id, organization_id, candidate_name, ashby_application_id, ashby_job_id, " +
      "candidate_evaluation_id, external_id, 'weave_candidate_evaluation' AS source, source_metadata " +
      "FROM linked " +
      "WHERE candidate_evaluation_id IS NOT NULL " +
      jobFilter +
      "ORDER BY session_id ASC " +
      `LIMIT ${limitPlaceholder}`,
    values,
  };
}

export function weaveCandidateEvaluationsByIdStatement(ids: readonly string[]): SqlStatement {
  if (ids.length === 0) {
    return {
      text:
        "SELECT NULL::text AS candidate_evaluation_id, NULL::text AS ashby_candidate_id, " +
        "NULL::text AS ashby_application_id, NULL::text AS ashby_job_id, NULL::text AS candidate_name, " +
        "NULL::date AS interview_date, NULL::numeric AS problem_solving, NULL::numeric AS agency, " +
        "NULL::numeric AS competitiveness, NULL::numeric AS curious, NULL::numeric AS total_score, " +
        "NULL::text AS comments, 'weave_candidate_evaluation'::text AS source, " +
        "NULL::jsonb AS source_metadata WHERE false",
      values: [],
    };
  }

  const placeholders = ids.map((_, index) => `$${index + 1}`);

  return {
    text:
      "SELECT ev.id::text AS candidate_evaluation_id, ev.ashby_candidate_id, " +
      "ev.ashby_application_id, ev.ashby_job_id, ev.candidate_name, ev.interview_date, " +
      `${jsonNumeric("ev", ["problem_solving", "problemSolving"])} AS problem_solving, ` +
      `${jsonNumeric("ev", ["agency"])} AS agency, ` +
      `${jsonNumeric("ev", ["competitiveness"])} AS competitiveness, ` +
      `${jsonNumeric("ev", ["curious", "curiosity"])} AS curious, ` +
      "ev.sum AS total_score, " +
      "NULLIF(COALESCE(" +
      "to_jsonb(ev) ->> 'comments', " +
      "to_jsonb(ev) ->> 'comment', " +
      "to_jsonb(ev) ->> 'notes'" +
      "), '') AS comments, " +
      "'weave_candidate_evaluation' AS source, " +
      "jsonb_build_object(" +
      "'updatedAt', ev.updated_at, " +
      "'interviewDate', ev.interview_date" +
      ") AS source_metadata " +
      "FROM candidate_evaluations ev " +
      `WHERE ev.id::text IN (${placeholders.join(", ")}) ` +
      `ORDER BY array_position(ARRAY[${placeholders.join(", ")}]::text[], ev.id::text)`,
    values: [...ids],
  };
}

export function transcriptTurnsForEvaluationStatement(sessionIds: readonly string[]): SqlStatement {
  if (sessionIds.length === 0) {
    return {
      text:
        "SELECT NULL::text AS session_id, NULL::integer AS turn_index, " +
        "NULL::text AS speaker, NULL::text AS text WHERE false",
      values: [],
    };
  }

  const placeholders = sessionIds.map((_, index) => `$${index + 1}`);
  return {
    text:
      "SELECT session_id, turn_index, speaker, text " +
      "FROM transcript_turns " +
      `WHERE session_id IN (${placeholders.join(", ")}) ` +
      "ORDER BY session_id ASC, turn_index ASC",
    values: [...sessionIds],
  };
}

function safeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)));
}

function optionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pushValue(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function jsonNumeric(alias: string, keys: readonly string[]): string {
  const jsonKeys = keys.map((key) => `to_jsonb(${alias}) ->> '${key}'`).join(", ");
  return `NULLIF(COALESCE(${jsonKeys}), '')::numeric`;
}
