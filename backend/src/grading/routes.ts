import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { buildDraftRubric, validateRoleRubric } from "./rubric.js";
import {
  gradingProfileActivateStatement,
  gradingProfileByIdForUpdateStatement,
  gradingProfileDraftUpdateStatement,
  gradingProfilesForOrganizationStatement,
  nextRubricVersionStatement,
  reviewerFeedbackInsertStatement,
  rubricVersionApproveStatement,
  rubricVersionInsertStatement,
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

function hasUpdatedRow(result: { readonly rows?: readonly unknown[]; readonly rowCount?: number | null }): boolean {
  return Boolean(result.rows?.[0]) && result.rowCount !== 0;
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
      const rubric = buildDraftRubric({
        organizationId,
        ashbyJobId,
        jobName,
        historicalSessionCount: historicalSessionCount.value,
        matchedApplicationCount: matchedApplicationCount.value,
      });
      const rubricVersionId = randomUUID();
      const insert = rubricVersionInsertStatement({
        rubricVersionId,
        profileId: request.params.profileId,
        organizationId,
        ashbyJobId,
        version,
        status: "draft",
        rubric,
        generationInputs: {
          source: "weave_seeded_pilot",
          historicalSessionCount: historicalSessionCount.value,
          matchedApplicationCount: matchedApplicationCount.value,
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

  app.post<{ Params: { recommendationId: string } }>("/grading/recommendations/:recommendationId/feedback", async (request, reply) => {
    const body = objectValue(request.body);
    const sessionId = stringValue(body.sessionId);
    const organizationId = stringValue(body.organizationId);
    const reviewerEmail = stringValue(body.reviewerEmail);
    const reviewerDecision = stringValue(body.reviewerDecision);
    if (!sessionId || !organizationId || !reviewerEmail || !reviewerDecision) {
      return reply.code(400).send({
        error: "sessionId, organizationId, reviewerEmail, and reviewerDecision are required",
      });
    }
    if (!validReviewerDecision(reviewerDecision)) {
      return reply.code(400).send({ error: "reviewerDecision is invalid" });
    }
    const dimensionFeedback = body.dimensionFeedback === undefined ? {} : body.dimensionFeedback;
    if (!dimensionFeedback || typeof dimensionFeedback !== "object" || Array.isArray(dimensionFeedback)) {
      return reply.code(400).send({ error: "dimensionFeedback must be an object" });
    }

    const stmt = reviewerFeedbackInsertStatement({
      feedbackId: randomUUID(),
      recommendationId: request.params.recommendationId,
      sessionId,
      organizationId,
      reviewerEmail,
      reviewerDecision,
      overrideReason: stringValue(body.overrideReason),
      dimensionFeedback,
    });
    const result = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.code(201).send({ feedback: result.rows[0] });
  });
}
