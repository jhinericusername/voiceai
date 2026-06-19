import { describe, it, expect } from "vitest";
import { buildDeletionPlan } from "../src/db/deletion.js";

describe("buildDeletionPlan", () => {
  it("lists every table holding candidate data, children before parent", () => {
    const plan = buildDeletionPlan("sess1");
    const tables = plan.statements.map((s) => s.table);
    expect(tables).toEqual([
      "recording_artifacts",
      "recordings",
      "transcript_turns",
      "events",
      "audit_log",
      "assessments",
      "consent_records",
      "candidate_invites",
      "interview_ai_control_state",
      "sessions",
    ]);
    expect(tables.indexOf("interview_ai_control_state")).toBeLessThan(
      tables.indexOf("sessions"),
    );
    expect(plan.statements.every((s) => s.params[0] === "sess1")).toBe(true);
    expect(plan.statements[0].sql).toContain("DELETE FROM recording_artifacts");
  });

  it("includes object-storage prefix for media deletion", () => {
    const plan = buildDeletionPlan("sess1", "org1");
    expect(plan.storagePrefix).toBe("/org1/interviews/sess1/");
  });
});
