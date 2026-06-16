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
        historicalSessionCount: Number(body.historicalSessionCount ?? 0),
        matchedApplicationCount: Number(body.matchedApplicationCount ?? 0),
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
          historicalSessionCount: body.historicalSessionCount ?? 0,
          matchedApplicationCount: body.matchedApplicationCount ?? 0,
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
      const approve = rubricVersionApproveStatement({ rubricVersionId, approvedByEmail: actorEmail });
      await client.query(approve.sql, [...approve.params]);
      const activate = gradingProfileActivateStatement({
        profileId: request.params.profileId,
        activeRubricVersionId: rubricVersionId,
        actorEmail,
      });
      const activated = await client.query(activate.sql, [...activate.params]);
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
    const stmt = reviewerFeedbackInsertStatement({
      feedbackId: randomUUID(),
      recommendationId: request.params.recommendationId,
      sessionId: stringValue(body.sessionId) ?? "",
      organizationId: stringValue(body.organizationId) ?? "",
      reviewerEmail: stringValue(body.reviewerEmail) ?? "",
      reviewerDecision: stringValue(body.reviewerDecision) as "advance" | "hold" | "pass" | "needs_more_review",
      overrideReason: stringValue(body.overrideReason),
      dimensionFeedback: body.dimensionFeedback ?? {},
    });
    const result = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.code(201).send({ feedback: result.rows[0] });
  });
}
