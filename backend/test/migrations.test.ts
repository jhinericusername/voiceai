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
});
