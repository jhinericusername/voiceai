import { createHash } from "node:crypto";

const WEAVE_CANDIDATE_EVALUATION_SOURCE = "weave_supabase_candidate_evaluation";

export type WeaveCandidateEvaluationOperation = "INSERT" | "UPDATE";

export interface WeaveCandidateEvaluation {
  readonly sourceEvaluationId: string;
  readonly candidateName: string;
  readonly interviewDate: string | null;
  readonly problemSolving: number;
  readonly agency: number;
  readonly competitiveness: number;
  readonly curiosity: number;
  readonly totalScore: number;
  readonly comments: string;
  readonly ashbyApplicationId: string;
  readonly ashbyCandidateId: string;
  readonly ashbyJobId: string;
  readonly sourceCreatedAt: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly rawRecord: Record<string, unknown>;
}

export interface WeaveCandidateEvaluationEvent {
  readonly eventId: string;
  readonly source: typeof WEAVE_CANDIDATE_EVALUATION_SOURCE;
  readonly operation: WeaveCandidateEvaluationOperation;
  readonly evaluation: WeaveCandidateEvaluation;
}

export type WeaveCandidateEvaluationValidationResult =
  | { readonly ok: true; readonly event: WeaveCandidateEvaluationEvent }
  | { readonly ok: false; readonly reason: string };

export function validateWeaveCandidateEvaluationEvent(
  value: unknown,
): WeaveCandidateEvaluationValidationResult {
  const event = asRecord(value);
  if (!event) return invalid("event must be an object");

  const eventId = requiredString(event.eventId, "eventId");
  if (!eventId.ok) return eventId;

  if (event.source !== WEAVE_CANDIDATE_EVALUATION_SOURCE) {
    return invalid(`source must be ${WEAVE_CANDIDATE_EVALUATION_SOURCE}`);
  }

  const operation = operationValue(event.operation);
  if (!operation) return invalid("operation must be INSERT or UPDATE");

  const record = asRecord(event.record);
  if (!record) return invalid("record is required");

  const sourceEvaluationId = requiredString(record.id, "id");
  if (!sourceEvaluationId.ok) return sourceEvaluationId;

  const candidateName = requiredString(record.candidate_name, "candidate_name");
  if (!candidateName.ok) return candidateName;

  const ashbyApplicationId = requiredString(
    record.ashby_application_id,
    "ashby_application_id",
  );
  if (!ashbyApplicationId.ok) return ashbyApplicationId;

  const ashbyCandidateId = requiredString(
    record.ashby_candidate_id,
    "ashby_candidate_id",
  );
  if (!ashbyCandidateId.ok) return ashbyCandidateId;

  const ashbyJobId = requiredString(record.ashby_job_id, "ashby_job_id");
  if (!ashbyJobId.ok) return ashbyJobId;

  const problemSolving = scoreValue(record.problem_solving, "problem_solving");
  if (!problemSolving.ok) return problemSolving;

  const agency = scoreValue(record.agency, "agency");
  if (!agency.ok) return agency;

  const competitiveness = scoreValue(record.competitiveness, "competitiveness");
  if (!competitiveness.ok) return competitiveness;

  const curiosity = scoreValue(record.curious, "curious");
  if (!curiosity.ok) return curiosity;

  return {
    ok: true,
    event: {
      eventId: eventId.value,
      source: WEAVE_CANDIDATE_EVALUATION_SOURCE,
      operation,
      evaluation: {
        sourceEvaluationId: sourceEvaluationId.value,
        candidateName: candidateName.value,
        interviewDate: nullableString(record.interview_date),
        problemSolving: problemSolving.value,
        agency: agency.value,
        competitiveness: competitiveness.value,
        curiosity: curiosity.value,
        totalScore:
          problemSolving.value + agency.value + competitiveness.value + curiosity.value,
        comments: stringValue(record.comments),
        ashbyApplicationId: ashbyApplicationId.value,
        ashbyCandidateId: ashbyCandidateId.value,
        ashbyJobId: ashbyJobId.value,
        sourceCreatedAt: nullableString(record.created_at),
        sourceUpdatedAt: nullableString(record.updated_at),
        rawRecord: record,
      },
    },
  };
}

export function weaveReviewerEmail(sourceEvaluationId: string): string {
  const normalizedId = sourceEvaluationId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `weave-import+${normalizedId}@puddle.system`;
}

export function stableWeaveEvaluationPayloadHash(value: unknown): string {
  const json = JSON.stringify(stableJsonValue(value)) ?? "undefined";
  return createHash("sha256").update(json).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(
  value: unknown,
  fieldName: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string } {
  if (typeof value !== "string" || !value.trim()) {
    return invalid(`${fieldName} is required`);
  }
  return { ok: true, value: value.trim() };
}

function operationValue(value: unknown): WeaveCandidateEvaluationOperation | null {
  return value === "INSERT" || value === "UPDATE" ? value : null;
}

function scoreValue(
  value: unknown,
  fieldName: string,
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: string } {
  const parsed = numberValue(value);
  if (parsed === null || parsed < 0 || parsed > 4 || parsed * 2 !== Math.trunc(parsed * 2)) {
    return invalid(`${fieldName} must be a score from 0 to 4 in 0.5 increments`);
  }
  return { ok: true, value: parsed };
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function invalid(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

function stableJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map((item) => stableJsonValue(item));

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [key, stableJsonValue(entryValue)]),
  );
}
