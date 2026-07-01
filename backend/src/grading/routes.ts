import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { buildScoringCalibrationInput } from "./evaluation/calibration.js";
import { createGradingModelSelection } from "./modelProvider.js";
import { recommendInterview } from "./recommendation.js";
import { buildDraftRubric, validateRoleRubric } from "./rubric.js";
import { scoreTranscript } from "./scoring.js";
import {
  activeRubricForJobStatement,
  gradingProfileActivateStatement,
  gradingProfileByIdForUpdateStatement,
  gradingProfileDraftUpdateStatement,
  gradingProfilesForOrganizationStatement,
  historicalBackfillSessionsStatement,
  nextRubricVersionStatement,
  recommendationUpsertStatement,
  reviewerFeedbackInsertStatement,
  rubricVersionApproveStatement,
  rubricVersionInsertStatement,
  sessionForRecommendationStatement,
  transcriptTurnsForSessionStatement,
} from "./repository.js";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function countValue(value: unknown, fieldName: string): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: 0 };
  }
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return { ok: false, error: `${fieldName} must be a finite non-negative integer` };
  }
  return { ok: true, value: parsed };
}

function validReviewerDecision(value: string): value is "advance" | "hold" | "pass" | "needs_more_review" {
  return ["advance", "hold", "pass", "needs_more_review"].includes(value);
}

type NormalizedDimensionFeedback = Record<string, { correctedScore?: number; notes?: string }>;

function correctedScoreValue(
  value: unknown,
  fieldName: string,
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed * 2) ||
    parsed < 1 ||
    parsed > 4
  ) {
    return { ok: false, error: `${fieldName} must be a half-step score from 1 to 4` };
  }
  return { ok: true, value: parsed };
}

function notesValue(
  value: unknown,
  fieldName: string,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed || undefined };
}

function normalizedDimensionCorrection(
  value: unknown,
  fieldName: string,
): { ok: true; value: NormalizedDimensionFeedback[string] } | { ok: false; error: string } {
  if (typeof value === "number") {
    const correctedScore = correctedScoreValue(value, `${fieldName}.correctedScore`);
    return correctedScore.ok ? { ok: true, value: { correctedScore: correctedScore.value } } : correctedScore;
  }
  if (typeof value === "string") {
    const notes = notesValue(value, `${fieldName}.notes`);
    if (!notes.ok) {
      return notes;
    }
    if (!notes.value) {
      return { ok: false, error: `${fieldName} must include correctedScore or notes` };
    }
    return { ok: true, value: { notes: notes.value } };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `${fieldName} must be an object` };
  }

  const record = value as Record<string, unknown>;
  const correctedScore = correctedScoreValue(
    record.correctedScore ?? record.corrected_score ?? record.score,
    `${fieldName}.correctedScore`,
  );
  if (!correctedScore.ok) {
    return correctedScore;
  }
  const notes = notesValue(
    record.notes ?? record.note ?? record.correctedNotes ?? record.corrected_notes,
    `${fieldName}.notes`,
  );
  if (!notes.ok) {
    return notes;
  }
  if (correctedScore.value === undefined && notes.value === undefined) {
    return { ok: false, error: `${fieldName} must include correctedScore or notes` };
  }

  return {
    ok: true,
    value: {
      ...(correctedScore.value === undefined ? {} : { correctedScore: correctedScore.value }),
      ...(notes.value === undefined ? {} : { notes: notes.value }),
    },
  };
}

function dimensionFeedbackFromRecord(
  value: unknown,
): { ok: true; value: NormalizedDimensionFeedback } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "dimensionFeedback must be an object" };
  }

  const feedback: NormalizedDimensionFeedback = {};
  for (const [dimension, correction] of Object.entries(value as Record<string, unknown>)) {
    const key = dimension.trim();
    if (!key) {
      return { ok: false, error: "dimensionFeedback keys must be non-empty strings" };
    }
    const normalized = normalizedDimensionCorrection(correction, `dimensionFeedback.${key}`);
    if (!normalized.ok) {
      return normalized;
    }
    feedback[key] = normalized.value;
  }
  return { ok: true, value: feedback };
}

function dimensionFeedbackFromCorrectionsArray(
  value: unknown,
): { ok: true; value: NormalizedDimensionFeedback } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "dimensionCorrections must be an array" };
  }

  const feedback: NormalizedDimensionFeedback = {};
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: `dimensionCorrections[${index}] must be an object` };
    }
    const record = item as Record<string, unknown>;
    const dimension = stringValue(record.dimension) ?? stringValue(record.category) ?? stringValue(record.key);
    if (!dimension) {
      return { ok: false, error: `dimensionCorrections[${index}].dimension is required` };
    }
    const normalized = normalizedDimensionCorrection(record, `dimensionCorrections[${index}]`);
    if (!normalized.ok) {
      return normalized;
    }
    feedback[dimension] = normalized.value;
  }
  return { ok: true, value: feedback };
}

function reviewerDimensionFeedback(
  body: Record<string, unknown>,
): { ok: true; value: NormalizedDimensionFeedback } | { ok: false; error: string } {
  const feedback: NormalizedDimensionFeedback = {};
  if (body.dimensionFeedback !== undefined) {
    const fromRecord = dimensionFeedbackFromRecord(body.dimensionFeedback);
    if (!fromRecord.ok) {
      return fromRecord;
    }
    Object.assign(feedback, fromRecord.value);
  }
  if (body.dimensionCorrections !== undefined) {
    const fromCorrections = dimensionFeedbackFromCorrectionsArray(body.dimensionCorrections);
    if (!fromCorrections.ok) {
      return fromCorrections;
    }
    Object.assign(feedback, fromCorrections.value);
  }
  return { ok: true, value: feedback };
}

function hasUpdatedRow(result: { readonly rows?: readonly unknown[]; readonly rowCount?: number | null }): boolean {
  return Boolean(result.rows?.[0]) && result.rowCount !== 0;
}

function finiteNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recommendationPolicyFromRubric(rubric: unknown): {
  readonly bareMinimumRule: string;
  readonly minimumConfidence: number;
} {
  const rubricObject = objectValue(rubric);
  const recommendationPolicy = objectValue(rubricObject.recommendation_policy);
  const recommendationThresholds = objectValue(rubricObject.recommendation_thresholds);
  return {
    bareMinimumRule: stringValue(rubricObject.bare_minimum_rule) ?? "at_least_one_4_and_problem_solving_ge_3",
    minimumConfidence:
      finiteNumberValue(recommendationPolicy.minimum_confidence) ??
      finiteNumberValue(rubricObject.minimum_confidence) ??
      finiteNumberValue(recommendationThresholds.minimum_confidence) ??
      0.75,
  };
}

function roleRubricMatchesProfile(rubric: unknown, input: {
  readonly organizationId: string;
  readonly ashbyJobId: string;
}): boolean {
  const rubricObject = objectValue(rubric);
  const role = objectValue(rubricObject.role);
  return stringValue(role.organization_id) === input.organizationId &&
    stringValue(role.ashby_job_id) === input.ashbyJobId;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values));
}

export function registerGradingRoutes(app: FastifyInstance): void {
  app.post("/grading/company-state", async (request, reply) => {
    const body = objectValue(request.body);
    const organizationId = stringValue(body.organizationId);
    if (!organizationId) {
      return reply.code(400).send({ error: "organizationId is required" });
    }

    const stmt = gradingProfilesForOrganizationStatement(organizationId);
    const { rows } = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.send({ profiles: rows });
  });

  app.post<{ Params: { profileId: string } }>("/grading/profiles/:profileId/draft", async (request, reply) => {
    const body = objectValue(request.body);
    const organizationId = stringValue(body.organizationId);
    const actorEmail = stringValue(body.actorEmail);
    const jobName = stringValue(body.jobName) ?? "Selected Ashby role";
    if (!organizationId || !actorEmail) {
      return reply.code(400).send({ error: "organizationId and actorEmail are required" });
    }
    const historicalSessionCount = countValue(body.historicalSessionCount, "historicalSessionCount");
    if (!historicalSessionCount.ok) {
      return reply.code(400).send({ error: historicalSessionCount.error });
    }
    const matchedApplicationCount = countValue(body.matchedApplicationCount, "matchedApplicationCount");
    if (!matchedApplicationCount.ok) {
      return reply.code(400).send({ error: matchedApplicationCount.error });
    }

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const profileStmt = gradingProfileByIdForUpdateStatement(request.params.profileId, organizationId);
      const profileResult = await client.query(profileStmt.sql, [...profileStmt.params]);
      const profile = profileResult.rows[0] as Record<string, unknown> | undefined;
      const ashbyJobId = stringValue(profile?.ashby_job_id);
      if (!profile || !ashbyJobId) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "grading profile not found" });
      }

      const versionStmt = nextRubricVersionStatement(request.params.profileId);
      const versionResult = await client.query(versionStmt.sql, [...versionStmt.params]);
      const version = Number(versionResult.rows[0]?.next_version ?? 1);
      const submittedRubric = body.rubric;
      const rubric = submittedRubric === undefined
        ? buildDraftRubric({
            organizationId,
            ashbyJobId,
            jobName,
            historicalSessionCount: historicalSessionCount.value,
            matchedApplicationCount: matchedApplicationCount.value,
          })
        : submittedRubric;
      const validation = validateRoleRubric(rubric);
      if (!validation.ok) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: validation.error });
      }
      if (!roleRubricMatchesProfile(rubric, { organizationId, ashbyJobId })) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "rubric role must match the grading profile" });
      }
      const rubricVersionId = randomUUID();
      const insert = rubricVersionInsertStatement({
        rubricVersionId,
        profileId: request.params.profileId,
        organizationId,
        ashbyJobId,
        version,
        status: "draft",
        rubric,
        generationInputs: submittedRubric === undefined
          ? {
              source: "weave_seeded_pilot",
              historicalSessionCount: historicalSessionCount.value,
              matchedApplicationCount: matchedApplicationCount.value,
            }
          : {
              source: "dashboard_rubric_editor",
              jobName,
            },
      });
      await client.query(insert.sql, [...insert.params]);
      const update = gradingProfileDraftUpdateStatement({
        profileId: request.params.profileId,
        draftRubricVersionId: rubricVersionId,
        actorEmail,
      });
      await client.query(update.sql, [...update.params]);
      await client.query("COMMIT");
      return reply.code(201).send({ rubricVersionId, rubric });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post<{ Params: { profileId: string } }>("/grading/profiles/:profileId/approve", async (request, reply) => {
    const body = objectValue(request.body);
    const organizationId = stringValue(body.organizationId);
    const actorEmail = stringValue(body.actorEmail);
    const rubricVersionId = stringValue(body.rubricVersionId);
    const rubric = body.rubric;
    if (!organizationId || !actorEmail || !rubricVersionId) {
      return reply.code(400).send({ error: "organizationId, actorEmail, and rubricVersionId are required" });
    }
    const validation = validateRoleRubric(rubric);
    if (!validation.ok) {
      return reply.code(400).send({ error: validation.error });
    }

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const profileStmt = gradingProfileByIdForUpdateStatement(request.params.profileId, organizationId);
      const profileResult = await client.query(profileStmt.sql, [...profileStmt.params]);
      const profile = profileResult.rows[0] as Record<string, unknown> | undefined;
      if (!profile) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "grading profile not found" });
      }
      if (stringValue(profile.draft_rubric_version_id) !== rubricVersionId) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "rubric version is not the current draft" });
      }

      const approve = rubricVersionApproveStatement({
        rubricVersionId,
        profileId: request.params.profileId,
        organizationId,
        rubric,
        approvedByEmail: actorEmail,
      });
      const approved = await client.query(approve.sql, [...approve.params]);
      if (!hasUpdatedRow(approved)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "rubric version is not the current draft" });
      }
      const activate = gradingProfileActivateStatement({
        profileId: request.params.profileId,
        organizationId,
        activeRubricVersionId: rubricVersionId,
        actorEmail,
      });
      const activated = await client.query(activate.sql, [...activate.params]);
      if (!hasUpdatedRow(activated)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "grading profile activation failed" });
      }
      await client.query("COMMIT");
      return reply.send({ profile: activated.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post<{ Params: { sessionId: string } }>("/grading/recommendations/session/:sessionId", async (request, reply) => {
    const body = objectValue(request.body);
    const organizationId = stringValue(body.organizationId);
    if (!organizationId) {
      return reply.code(400).send({ error: "organizationId is required" });
    }

    const sessionStmt = sessionForRecommendationStatement(request.params.sessionId, organizationId);
    const sessionResult = await getPool().query(sessionStmt.sql, [...sessionStmt.params]);
    const session = sessionResult.rows[0] as Record<string, unknown> | undefined;
    if (!session) {
      return reply.code(404).send({ error: "session not found" });
    }
    const ashbyJobId = stringValue(session.ashby_job_id);
    if (!ashbyJobId) {
      return reply.code(409).send({ error: "session is missing ashbyJobId" });
    }

    const transcriptStmt = transcriptTurnsForSessionStatement(request.params.sessionId);
    const transcriptResult = await getPool().query(transcriptStmt.sql, [...transcriptStmt.params]);
    if (transcriptResult.rows.length === 0) {
      return reply.code(409).send({ error: "session transcript is not ready" });
    }

    const rubricStmt = activeRubricForJobStatement(organizationId, ashbyJobId);
    const rubricResult = await getPool().query(rubricStmt.sql, [...rubricStmt.params]);
    const activeRubric = rubricResult.rows[0] as Record<string, unknown> | undefined;
    const activeRubricVersionId = stringValue(activeRubric?.active_rubric_version_id);
    if (!activeRubric || !activeRubricVersionId) {
      return reply.code(409).send({ error: "active rubric is required" });
    }

    const scoringCalibration = buildScoringCalibrationInput();
    const modelSelection = createGradingModelSelection();
    const parsed = await scoreTranscript(
      {
        rubric: activeRubric.rubric,
        transcriptTurns: transcriptResult.rows,
        gradingGuide: scoringCalibration.gradingGuide,
        dimensionScoreAnchors: scoringCalibration.dimensionScoreAnchors,
        calibrationExamples: scoringCalibration.calibrationExamples,
      },
      modelSelection.model,
    );
    const categoryScoresForRecommendation = parsed.categoryScores.map((categoryScore) => ({
      category: categoryScore.category,
      score: categoryScore.score,
      confidence: categoryScore.confidence ?? 0,
      evidenceQuotes: categoryScore.evidenceQuotes,
    }));
    const policy = recommendationPolicyFromRubric(activeRubric.rubric);
    const deterministicRecommendation = recommendInterview({
      categoryScores: categoryScoresForRecommendation,
      bareMinimumRule: policy.bareMinimumRule,
      minimumConfidence: policy.minimumConfidence,
      severeWarnings: parsed.warnings,
    });
    const warnings = uniqueStrings([...deterministicRecommendation.warnings, ...parsed.warnings]);
    const upsert = recommendationUpsertStatement({
      recommendationId: randomUUID(),
      sessionId: request.params.sessionId,
      organizationId,
      ashbyJobId,
      rubricVersionId: activeRubricVersionId,
      source: session.external_source === "fireflies" ? "historical_fireflies" : "puddle_live",
      recommendation: deterministicRecommendation.recommendation,
      confidence: deterministicRecommendation.confidence,
      categoryScores: parsed.categoryScores,
      evidence: {
        categoryScores: parsed.categoryScores.map((categoryScore) => ({
          category: categoryScore.category,
          evidenceQuotes: categoryScore.evidenceQuotes,
          rationale: categoryScore.rationale,
        })),
      },
      scorecardJson: parsed.scorecard,
      warnings,
      modelMetadata: { ...modelSelection.metadata, parser: "grading-scorecard-v1" },
    });
    const saved = await getPool().query(upsert.sql, [...upsert.params]);
    if (!hasUpdatedRow(saved)) {
      return reply.code(409).send({ error: "recommendation could not be stored" });
    }
    return reply.code(201).send({ recommendation: saved.rows[0] });
  });

  app.post("/grading/recommendations/backfill-historical", async (request, reply) => {
    const body = objectValue(request.body);
    const organizationId = stringValue(body.organizationId);
    const ashbyJobId = stringValue(body.ashbyJobId);
    if (!organizationId || !ashbyJobId) {
      return reply.code(400).send({ error: "organizationId and ashbyJobId are required" });
    }
    let limit = 10;
    if (body.limit !== undefined) {
      const parsedLimit = countValue(body.limit, "limit");
      if (!parsedLimit.ok) {
        return reply.code(400).send({ error: parsedLimit.error });
      }
      limit = Math.min(parsedLimit.value, 25);
    }

    const stmt = historicalBackfillSessionsStatement(organizationId, ashbyJobId, limit);
    const result = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.send({ queued: result.rows.map((row: { readonly session_id: string }) => row.session_id) });
  });

  app.post<{ Params: { recommendationId: string } }>("/grading/recommendations/:recommendationId/feedback", async (request, reply) => {
    const body = objectValue(request.body);
    const sessionId = stringValue(body.sessionId);
    const organizationId = stringValue(body.organizationId);
    const reviewerEmail = stringValue(body.reviewerEmail);
    const reviewerDecision = stringValue(body.reviewerDecision) ?? stringValue(body.decision);
    if (!sessionId || !organizationId || !reviewerEmail || !reviewerDecision) {
      return reply.code(400).send({
        error: "sessionId, organizationId, reviewerEmail, and reviewerDecision are required",
      });
    }
    if (!validReviewerDecision(reviewerDecision)) {
      return reply.code(400).send({ error: "reviewerDecision is invalid" });
    }
    const dimensionFeedback = reviewerDimensionFeedback(body);
    if (!dimensionFeedback.ok) {
      return reply.code(400).send({ error: dimensionFeedback.error });
    }

    const stmt = reviewerFeedbackInsertStatement({
      feedbackId: randomUUID(),
      recommendationId: request.params.recommendationId,
      sessionId,
      organizationId,
      reviewerEmail,
      reviewerDecision,
      overrideReason: stringValue(body.overrideReason) ?? stringValue(body.reviewerNotes) ?? stringValue(body.notes),
      dimensionFeedback: dimensionFeedback.value,
    });
    const result = await getPool().query(stmt.sql, [...stmt.params]);
    if (!hasUpdatedRow(result)) {
      return reply.code(404).send({ error: "recommendation not found" });
    }
    return reply.code(201).send({ feedback: result.rows[0] });
  });
}
