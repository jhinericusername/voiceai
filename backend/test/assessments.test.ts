import { describe, expect, it } from "vitest";
import {
  assessmentBySessionStatement,
  assessmentUpsertStatement,
} from "../src/assessments/repository.js";

describe("assessment persistence", () => {
  it("upserts assessment JSON for a session", () => {
    const stmt = assessmentUpsertStatement({
      sessionId: "sess1",
      scriptVersion: "pilot-v1",
      categoryScores: [
        {
          category: "agency",
          score: 4,
          confidence: 0.91,
          evidenceQuotes: ["I owned the rollout"],
          rationale: "Strong ownership signal.",
          lowConfidence: false,
        },
      ],
      meetsBareMinimum: true,
      integrityFlags: [],
    });

    expect(stmt.sql).toContain("INSERT INTO assessments");
    expect(stmt.sql).toContain("ON CONFLICT (session_id) DO UPDATE");
    expect(stmt.sql).toContain("VALUES ($1, $2, $3::jsonb, $4, $5::jsonb)");
    expect(stmt.sql).toContain("reviewer_email = NULL, signed_off_at = NULL");
    expect(stmt.params[0]).toBe("sess1");
    expect(stmt.params[1]).toBe("pilot-v1");
    expect(JSON.parse(String(stmt.params[2]))).toEqual([
      {
        category: "agency",
        score: 4,
        confidence: 0.91,
        evidence_quotes: ["I owned the rollout"],
        rationale: "Strong ownership signal.",
        low_confidence: false,
      },
    ]);
    expect(stmt.params[3]).toBe(true);
    expect(JSON.parse(String(stmt.params[4]))).toEqual([]);
  });

  it("queries one assessment by session", () => {
    const stmt = assessmentBySessionStatement("sess1");

    expect(stmt.sql).toContain("FROM assessments WHERE session_id = $1");
    expect(stmt.params).toEqual(["sess1"]);
  });
});
