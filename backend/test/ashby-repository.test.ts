import { describe, expect, it } from "vitest";
import {
  activeApplicationUpsertStatement,
  inactiveCandidateApplicationsStatement,
  integrationByIdStatement,
  integrationLookupStatement,
  integrationSetupUpsertStatement,
  isValidEmailDomain,
  markIntegrationPingStatement,
  normalizeEmailDomain,
  recentScreensStatement,
  scoreUpsertStatement,
  searchActiveApplicationsStatement,
  webhookEventProcessedStatement,
  webhookEventInsertStatement,
} from "../src/ashby/repository.js";

describe("Ashby repository statements", () => {
  it("normalizes company integration lookup by email domain", () => {
    const stmt = integrationLookupStatement({ organizationId: null, emailDomain: "UsePuddle.COM" });

    expect(normalizeEmailDomain(" UsePuddle.COM ")).toBe("usepuddle.com");
    expect(stmt.sql).toContain("ashby_company_integrations");
    expect(stmt.params).toEqual([null, "usepuddle.com"]);
  });

  it("builds integration lookup by id", () => {
    const stmt = integrationByIdStatement("int_1");

    expect(stmt.sql).toContain("WHERE integration_id = $1");
    expect(stmt.params).toEqual(["int_1"]);
  });

  it("validates email domains", () => {
    expect(isValidEmailDomain("usepuddle.com")).toBe(true);
    expect(isValidEmailDomain("sub.use-puddle.co")).toBe(true);
    expect(isValidEmailDomain("not-an-email-domain")).toBe(false);
    expect(isValidEmailDomain("-usepuddle.com")).toBe(false);
    expect(isValidEmailDomain("usepuddle.com/evil")).toBe(false);
  });

  it("builds setup upsert statement", () => {
    const stmt = integrationSetupUpsertStatement({
      emailDomain: "UsePuddle.COM",
      organizationId: "org_123",
      ashbyApiKeyCiphertext: "v1:encrypted",
      selectedJobIds: ["job_1"],
      integrationId: "int_1",
    });

    expect(stmt.sql).toContain("WITH matching_integrations AS");
    expect(stmt.sql).toContain("UPDATE ashby_company_integrations");
    expect(stmt.sql).toContain("FOR UPDATE");
    expect(stmt.sql).toContain("identity_conflict");
    expect(stmt.params).toEqual(["int_1", "org_123", "usepuddle.com", "v1:encrypted", ["job_1"]]);
  });

  it("returns a controlled setup conflict when organization and domain point to different rows", () => {
    const stmt = integrationSetupUpsertStatement({
      emailDomain: "usepuddle.com",
      organizationId: "org_123",
      ashbyApiKeyCiphertext: "v1:encrypted",
      selectedJobIds: [],
      integrationId: "int_1",
    });

    expect(stmt.sql).toContain("count(DISTINCT integration_id) > 1 AS has_conflict");
    expect(stmt.sql).toContain("AND NOT (SELECT has_conflict FROM identity_conflict)");
    expect(stmt.sql).toContain("NULL::text AS integration_id, true AS identity_conflict");
  });

  it("deduplicates webhook events by Ashby webhookActionId", () => {
    const stmt = webhookEventInsertStatement({
      webhookActionId: "action_1",
      integrationId: "int_1",
      action: "applicationUpdate",
      payload: { action: "applicationUpdate" },
    });

    expect(stmt.sql).toContain("ON CONFLICT (webhook_action_id) DO NOTHING");
    expect(stmt.sql).toContain("RETURNING true AS inserted, processed_at");
    expect(stmt.sql).toContain("SELECT false AS inserted, processed_at FROM ashby_webhook_events");
    expect(stmt.params).toEqual([
      "action_1",
      "int_1",
      "applicationUpdate",
      JSON.stringify({ action: "applicationUpdate" }),
    ]);
  });

  it("marks integration pings and webhook events as processed", () => {
    const pingStmt = markIntegrationPingStatement("int_1");
    const processedStmt = webhookEventProcessedStatement("action_1");

    expect(pingStmt.sql).toContain("last_ping_at = now()");
    expect(pingStmt.sql).toContain("connected_at = COALESCE");
    expect(pingStmt.params).toEqual(["int_1"]);
    expect(processedStmt.sql).toContain("processed_at = now()");
    expect(processedStmt.params).toEqual(["action_1"]);
  });

  it("upserts active applications against the integration/application composite identity", () => {
    const stmt = activeApplicationUpsertStatement({
      applicationId: "app_1",
      integrationId: "int_1",
      candidateId: "cand_1",
      candidateName: "Maya Chen",
      candidateEmail: "maya@example.com",
      jobId: "job_1",
      currentStage: "Screen",
      source: "Ashby",
      status: "Active",
      ashbyUpdatedAt: "2026-06-10T12:00:00.000Z",
      rawPayload: { id: "app_1" },
    });

    expect(stmt.sql).toContain("INSERT INTO ashby_applications");
    expect(stmt.sql).toContain("ON CONFLICT (integration_id, application_id)");
    expect(stmt.params).toEqual([
      "app_1",
      "int_1",
      "cand_1",
      "Maya Chen",
      "maya@example.com",
      "job_1",
      "Screen",
      "Ashby",
      "Active",
      "2026-06-10T12:00:00.000Z",
      JSON.stringify({ id: "app_1" }),
    ]);
  });

  it("searches active applications by candidate name or email", () => {
    const stmt = searchActiveApplicationsStatement({
      integrationId: "int_1",
      jobId: "job_1",
      query: " maya ",
      limit: 8,
    });

    expect(stmt.sql).toContain("status = 'Active'");
    expect(stmt.sql).toContain("lower(candidate_name)");
    expect(stmt.params).toEqual(["int_1", "job_1", "maya", 8]);
  });

  it("marks candidate applications inactive within an integration", () => {
    const stmt = inactiveCandidateApplicationsStatement({
      integrationId: "int_1",
      candidateId: "cand_1",
      status: "Archived",
    });

    expect(stmt.sql).toContain("UPDATE ashby_applications");
    expect(stmt.sql).toContain("WHERE integration_id = $1 AND candidate_id = $2");
    expect(stmt.params).toEqual(["int_1", "cand_1", "Archived"]);
  });

  it("calculates total score and includes the composite foreign key values", () => {
    const stmt = scoreUpsertStatement({
      integrationId: "int_1",
      emailDomain: "usepuddle.com",
      applicationId: "app_1",
      roleId: "founding-engineer",
      reviewerEmail: "reviewer@usepuddle.com",
      problemSolving: 3,
      agency: 3.5,
      competitiveness: 2,
      curiosity: 4,
      comments: "Strong systems answer.",
    });

    expect(stmt.sql).toContain("ashby_candidate_scores");
    expect(stmt.sql).toContain("(score_id, integration_id, application_id");
    expect(stmt.sql).toContain("ON CONFLICT (integration_id, application_id, reviewer_email)");
    expect(stmt.params[1]).toBe("int_1");
    expect(stmt.params[2]).toBe("app_1");
    expect(stmt.params[9]).toBe(12.5);
  });

  it("rejects scores outside the allowed range and increment", () => {
    const validScore = {
      integrationId: "int_1",
      emailDomain: "usepuddle.com",
      applicationId: "app_1",
      roleId: "founding-engineer",
      reviewerEmail: "reviewer@usepuddle.com",
      problemSolving: 3,
      agency: 3.5,
      competitiveness: 2,
      curiosity: 4,
      comments: "",
    };

    expect(() => scoreUpsertStatement({ ...validScore, problemSolving: -0.5 })).toThrow(
      "problemSolving must be a score from 0 to 4 in 0.5 increments",
    );
    expect(() => scoreUpsertStatement({ ...validScore, agency: 4.5 })).toThrow(
      "agency must be a score from 0 to 4 in 0.5 increments",
    );
    expect(() => scoreUpsertStatement({ ...validScore, curiosity: 2.25 })).toThrow(
      "curiosity must be a score from 0 to 4 in 0.5 increments",
    );
  });

  it("builds recent screens query with candidate details", () => {
    const stmt = recentScreensStatement({ integrationId: "int_1", limit: 10 });

    expect(stmt.sql).toContain("FROM ashby_candidate_scores s JOIN ashby_applications a");
    expect(stmt.sql).toContain("a.integration_id = s.integration_id");
    expect(stmt.sql).toContain("ORDER BY s.updated_at DESC LIMIT $2");
    expect(stmt.params).toEqual(["int_1", 10]);
  });
});
