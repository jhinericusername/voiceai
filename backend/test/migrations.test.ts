import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(import.meta.dirname, "..", "migrations");

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
});
