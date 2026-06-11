import { describe, expect, it } from "vitest";
import {
  interviewDetailStatement,
  interviewListStatement,
} from "../src/dashboard/interviews.js";

describe("dashboard interview read model", () => {
  it("queries recent interview packets", () => {
    const stmt = interviewListStatement({ limit: 25 });

    expect(stmt.sql).toContain("FROM sessions s");
    expect(stmt.sql).toContain("LEFT JOIN recordings r");
    expect(stmt.sql).toContain("LEFT JOIN assessments a");
    expect(stmt.sql).toContain("LIMIT $1");
    expect(stmt.params).toEqual([25]);
  });

  it("queries one interview packet detail", () => {
    const stmt = interviewDetailStatement("sess1");

    expect(stmt.sql).toContain("WHERE s.session_id = $1");
    expect(stmt.sql).toContain("json_agg");
    expect(stmt.params).toEqual(["sess1"]);
  });
});
