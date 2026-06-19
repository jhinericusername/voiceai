import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(import.meta.dirname, "..", "migrations");
const weaveMigrationsDir = join(import.meta.dirname, "..", "weave-migrations");

describe("database migrations", () => {
  it("repairs early Ashby application and score uniqueness constraints after 005", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const ashbyIndex = files.indexOf("005_ashby_integrations.sql");
    const repairIndex = files.indexOf("006_repair_ashby_composite_keys.sql");

    expect(ashbyIndex).toBeGreaterThanOrEqual(0);
    expect(repairIndex).toBeGreaterThan(ashbyIndex);

    const migration = readFileSync(join(migrationsDir, "006_repair_ashby_composite_keys.sql"), "utf-8");
    expect(migration).toContain("DROP CONSTRAINT ashby_applications_pkey");
    expect(migration).toContain("PRIMARY KEY (integration_id, application_id)");
    expect(migration).toContain(
      "DROP CONSTRAINT IF EXISTS ashby_candidate_scores_application_id_reviewer_email_key",
    );
    expect(migration).toContain("UNIQUE (integration_id, application_id, reviewer_email)");
  });

  it("keeps Ashby self-serve onboarding migration after composite key repair", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const repairIndex = files.indexOf("006_repair_ashby_composite_keys.sql");
    const selfServeIndex = files.indexOf("007_ashby_self_serve_onboarding.sql");
    expect(repairIndex).toBeGreaterThanOrEqual(0);
    expect(selfServeIndex).toBeGreaterThanOrEqual(0);
    expect(selfServeIndex).toBeGreaterThan(repairIndex);

    const migration = readFileSync(join(migrationsDir, "007_ashby_self_serve_onboarding.sql"), "utf-8");
    expect(migration).toContain("ashby_webhook_secret_ciphertext");
    expect(migration).toContain("setup_status TEXT NOT NULL DEFAULT 'pending_webhook'");
    expect(migration).toContain("last_sync_at");
    expect(migration).toContain("created_by_email");
    expect(migration).toContain("updated_by_email");
    expect(migration).toContain("ashby_company_integrations_setup_status_check");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS ashby_company_integrations_setup_status_idx");
    expect(migration).toContain("'job_selection_pending'");
    expect(migration).toContain("'pending_webhook'");
    expect(migration).toContain("'connected'");
    expect(migration).toContain("'error'");
    expect(migration).toContain("WHEN connected_at IS NOT NULL THEN 'connected'");
    expect(migration).toContain(
      "WHEN array_length(selected_job_ids, 1) IS NULL OR array_length(selected_job_ids, 1) = 0 THEN 'job_selection_pending'",
    );
    expect(migration).toContain("ELSE 'pending_webhook'");
  });

  it("keeps Ashby onboarding hardening after self-serve onboarding and repairs migrated connected rows without webhook secrets", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const selfServeIndex = files.indexOf("007_ashby_self_serve_onboarding.sql");
    const hardeningIndex = files.indexOf("008_ashby_onboarding_hardening.sql");

    expect(selfServeIndex).toBeGreaterThanOrEqual(0);
    expect(hardeningIndex).toBeGreaterThan(selfServeIndex);

    const migration = readFileSync(join(migrationsDir, "008_ashby_onboarding_hardening.sql"), "utf-8");
    expect(migration).toContain("ashby_webhook_secret_ciphertext IS NULL");
    expect(migration).toContain("setup_status = 'job_selection_pending'");
    expect(migration).toContain("connected_at = NULL");
    expect(migration).toContain("last_ping_at = NULL");
    expect(migration).toContain("last_sync_at = NULL");
    expect(migration).toContain("UPDATE ashby_applications");
    expect(migration).toContain("status = 'Stale'");
    expect(migration).toContain("status = 'Active'");
  });

  it("adds append-only Ashby integration audit events after onboarding hardening", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const hardeningIndex = files.indexOf("008_ashby_onboarding_hardening.sql");
    const auditIndex = files.indexOf("009_ashby_integration_audit.sql");

    expect(hardeningIndex).toBeGreaterThanOrEqual(0);
    expect(auditIndex).toBeGreaterThan(hardeningIndex);

    const migration = readFileSync(join(migrationsDir, "009_ashby_integration_audit.sql"), "utf-8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS ashby_integration_audit_events");
    expect(migration).toContain("integration_id TEXT NOT NULL");
    expect(migration).not.toContain("ON DELETE CASCADE");
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toContain("actor_email TEXT NOT NULL");
    expect(migration).toContain("action TEXT NOT NULL");
    expect(migration).toContain("metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("created_at TIMESTAMPTZ NOT NULL DEFAULT now()");
    expect(migration).toContain("api_key_replaced");
    expect(migration).toContain("jobs_selected");
    expect(migration).toContain("active_applications_synced");
  });

  it("drops Ashby email-domain uniqueness after audit migration for org-scoped tenancy", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const auditIndex = files.indexOf("009_ashby_integration_audit.sql");
    const orgTenantingIndex = files.indexOf("010_ashby_org_tenanting.sql");

    expect(auditIndex).toBeGreaterThanOrEqual(0);
    expect(orgTenantingIndex).toBeGreaterThan(auditIndex);

    const migration = readFileSync(join(migrationsDir, "010_ashby_org_tenanting.sql"), "utf-8");
    expect(migration).toContain("DROP INDEX IF EXISTS ashby_company_integrations_email_domain_idx");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS ashby_company_integrations_email_domain_lookup_idx");
    expect(migration).not.toContain("CREATE UNIQUE INDEX");
  });

  it("adds source metadata for historical interview imports after Ashby org tenanting", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const orgTenantingIndex = files.indexOf("010_ashby_org_tenanting.sql");
    const historicalSourcesIndex = files.indexOf("011_historical_interview_sources.sql");

    expect(orgTenantingIndex).toBeGreaterThanOrEqual(0);
    expect(historicalSourcesIndex).toBeGreaterThan(orgTenantingIndex);

    const migration = readFileSync(join(migrationsDir, "011_historical_interview_sources.sql"), "utf-8");
    expect(migration).toContain("ALTER TABLE sessions");
    expect(migration).toContain("external_source");
    expect(migration).toContain("external_id");
    expect(migration).toContain("sessions_external_source_id_idx");
    expect(migration).toContain("historical_interview_import_runs");
  });

  it("adds company grading tables after historical interview source tracking", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const historicalIndex = files.indexOf("011_historical_interview_sources.sql");
    const gradingIndex = files.indexOf("012_company_grading.sql");

    expect(historicalIndex).toBeGreaterThanOrEqual(0);
    expect(gradingIndex).toBeGreaterThan(historicalIndex);

    const migration = readFileSync(join(migrationsDir, "012_company_grading.sql"), "utf-8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS role_grading_profiles");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS role_rubric_versions");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS interview_recommendations");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS reviewer_feedback");
    expect(migration).toContain("ashby_company_integrations_integration_org_idx");
    expect(migration).toContain("sessions_session_org_idx");
    expect(migration).toContain("UNIQUE (organization_id, ashby_job_id)");
    expect(migration).toContain("UNIQUE (profile_id, organization_id, ashby_job_id)");
    expect(migration).toContain("role_grading_profiles_org_integration_idx");
    expect(migration).toContain("UNIQUE (rubric_version_id, profile_id)");
    expect(migration).toContain("UNIQUE (rubric_version_id, organization_id, ashby_job_id)");
    expect(migration).toContain("FOREIGN KEY (ashby_integration_id, organization_id)");
    expect(migration).toContain("FOREIGN KEY (profile_id, organization_id, ashby_job_id)");
    expect(migration).toContain("FOREIGN KEY (active_rubric_version_id, profile_id)");
    expect(migration).toContain("FOREIGN KEY (draft_rubric_version_id, profile_id)");
    expect(migration).toContain("FOREIGN KEY (session_id, organization_id)");
    expect(migration).toContain("FOREIGN KEY (rubric_version_id, organization_id, ashby_job_id)");
    expect(migration).toContain("UNIQUE (session_id, rubric_version_id)");
    expect(migration).toContain("UNIQUE (recommendation_id, session_id, organization_id)");
    expect(migration).toContain("FOREIGN KEY (recommendation_id, session_id, organization_id)");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS interview_recommendations \([\s\S]*created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\),[\s\S]*updated_at TIMESTAMPTZ NOT NULL DEFAULT now\(\),[\s\S]*UNIQUE \(session_id, rubric_version_id\)/,
    );
    expect(migration).toContain("recommendation IN ('advance', 'hold', 'pass')");
    expect(migration).toContain("reviewer_decision IN ('advance', 'hold', 'pass', 'needs_more_review')");
  });

  it("adds recommendation updated-at migration after company grading", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const gradingIndex = files.indexOf("012_company_grading.sql");
    const updatedAtIndex = files.indexOf("013_interview_recommendations_updated_at.sql");

    expect(gradingIndex).toBeGreaterThanOrEqual(0);
    expect(updatedAtIndex).toBeGreaterThan(gradingIndex);

    const migration = readFileSync(
      join(migrationsDir, "013_interview_recommendations_updated_at.sql"),
      "utf-8",
    );
    expect(migration).toContain("ALTER TABLE interview_recommendations");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS updated_at");
    expect(migration).toContain("updated_at TIMESTAMPTZ NOT NULL DEFAULT now()");
  });

  it("adds interviewer AI control state after recommendation updated-at migration", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const recommendationUpdatedAtIndex = files.indexOf("013_interview_recommendations_updated_at.sql");
    const aiControlIndex = files.indexOf("015_interviewer_ai_control_state.sql");

    expect(recommendationUpdatedAtIndex).toBeGreaterThanOrEqual(0);
    expect(aiControlIndex).toBeGreaterThan(recommendationUpdatedAtIndex);

    const migration = readFileSync(
      join(migrationsDir, "015_interviewer_ai_control_state.sql"),
      "utf-8",
    );
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS interview_ai_control_state");
    expect(migration).toContain("session_id             TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE");
    expect(migration).toContain("requested_state        TEXT NOT NULL CHECK (requested_state IN ('running', 'stopped'))");
    expect(migration).toContain("requested_by_user_id   TEXT NOT NULL");
    expect(migration).toContain("requested_by_email     TEXT NOT NULL");
    expect(migration).toContain("requested_at           TIMESTAMPTZ NOT NULL DEFAULT now()");
    expect(migration).toContain("updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()");
    expect(migration).toContain("interview_ai_control_state_requested_at_idx");
  });

  it("defines the Weave Fireflies reconciliation tables separately from app migrations", () => {
    const files = readdirSync(weaveMigrationsDir).filter((file) => file.endsWith(".sql")).sort();

    expect(files).toContain("001_fireflies_reconciliation.sql");

    const migration = readFileSync(
      join(weaveMigrationsDir, "001_fireflies_reconciliation.sql"),
      "utf-8",
    );
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS weave_fireflies_recordings");
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS weave_fireflies_recording_match_candidates",
    );
    expect(migration).toContain("match_status IN ('matched', 'ambiguous', 'unmatched')");
    expect(migration).toContain("UNIQUE (s3_bucket, s3_prefix)");
  });

  it("migrates Fireflies match options to application-level identity", () => {
    const files = readdirSync(weaveMigrationsDir).filter((file) => file.endsWith(".sql")).sort();

    expect(files).toContain("002_fireflies_application_reconciliation.sql");

    const migration = readFileSync(
      join(weaveMigrationsDir, "002_fireflies_application_reconciliation.sql"),
      "utf-8",
    );
    expect(migration).toContain("decision_source");
    expect(migration).toContain("decision_reason");
    expect(migration).toContain("ALTER TABLE weave_fireflies_recording_match_candidates");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS id BIGINT");
    expect(migration).toContain("PRIMARY KEY (id)");
    expect(migration).toContain("ashby_application_id");
    expect(migration).toContain("weave_fireflies_match_candidates_unique_option_idx");
  });
});
