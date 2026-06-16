import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

const {
  queryMock,
  scoreTranscriptMock,
  sqlCalls,
  queryCalls,
  routeState,
} = vi.hoisted(() => {
  const sqlCalls: string[] = [];
  const queryCalls: Array<{ readonly sql: string; readonly params: readonly unknown[] }> = [];
  const routeState = {
    sessionRows: [
      {
        session_id: "sess_1",
        org_id: "org_1",
        external_source: "puddle_live",
        source_metadata: { ashby: { selected: { jobId: "job_1" } } },
        ashby_job_id: "job_1",
      },
    ] as Array<Record<string, unknown>>,
    transcriptRows: [
      { turnIndex: 0, speaker: "agent", text: "Tell me about a hard problem." },
      { turnIndex: 1, speaker: "candidate", text: "I built a migration and cut runtime by 90%." },
    ] as Array<Record<string, unknown>>,
    rubricRows: [
      {
        profile_id: "profile_1",
        active_rubric_version_id: "rv_1",
        rubric: {
          bare_minimum_rule: "at_least_one_4_and_problem_solving_ge_3",
          recommendation_policy: { minimum_confidence: 0.75 },
        },
      },
    ] as Array<Record<string, unknown>>,
    backfillRows: [
      { session_id: "sess_old_1" },
      { session_id: "sess_old_2" },
    ] as Array<Record<string, unknown>>,
    upsertRowCount: 1,
  };
  const scoreTranscriptMock = vi.fn(async () => ({
    categoryScores: [
      {
        category: "problem_solving",
        score: 4,
        confidence: 0.9,
        evidenceQuotes: ["cut runtime by 90%"],
        rationale: "Specific high-impact migration.",
      },
      {
        category: "agency",
        score: 3,
        confidence: 0.84,
        evidenceQuotes: ["owned the migration"],
        rationale: "Shows ownership.",
      },
    ],
    warnings: [],
  }));
  const queryMock = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    const sqlText = String(sql);
    sqlCalls.push(sqlText);
    queryCalls.push({ sql: sqlText, params });
    if (sqlText.includes("SELECT s.session_id FROM sessions s")) {
      return { rows: routeState.backfillRows, rowCount: routeState.backfillRows.length };
    }
    if (sqlText.includes("FROM sessions s WHERE s.session_id")) {
      return { rows: routeState.sessionRows, rowCount: routeState.sessionRows.length };
    }
    if (sqlText.includes("FROM transcript_turns")) {
      return { rows: routeState.transcriptRows, rowCount: routeState.transcriptRows.length };
    }
    if (sqlText.includes("FROM role_grading_profiles p")) {
      return { rows: routeState.rubricRows, rowCount: routeState.rubricRows.length };
    }
    if (sqlText.includes("INSERT INTO interview_recommendations")) {
      return {
        rows: routeState.upsertRowCount === 0
          ? []
          : [
              {
                recommendation_id: params[0],
                session_id: params[1],
                organization_id: params[2],
                ashby_job_id: params[3],
                rubric_version_id: params[4],
                source: params[5],
                recommendation: params[6],
                confidence: params[7],
                category_scores: JSON.parse(String(params[8])),
                evidence: JSON.parse(String(params[9])),
                warnings: JSON.parse(String(params[10])),
                model_metadata: JSON.parse(String(params[11])),
              },
            ],
        rowCount: routeState.upsertRowCount,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  return { queryMock, scoreTranscriptMock, sqlCalls, queryCalls, routeState };
});

vi.mock("../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock }),
}));

vi.mock("../src/grading/scoring.js", () => ({
  scoreTranscript: scoreTranscriptMock,
}));

vi.mock("../src/grading/bedrock.js", () => ({
  BedrockGradingModel: class FakeBedrockGradingModel {},
}));

const FAKE_LK = { host: "wss://example", apiKey: "key", apiSecret: "secret" };
const previousBackendToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;

describe("grading session recommendations", () => {
  beforeEach(() => {
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    sqlCalls.length = 0;
    queryCalls.length = 0;
    routeState.sessionRows = [
      {
        session_id: "sess_1",
        org_id: "org_1",
        external_source: "puddle_live",
        source_metadata: { ashby: { selected: { jobId: "job_1" } } },
        ashby_job_id: "job_1",
      },
    ];
    routeState.transcriptRows = [
      { turnIndex: 0, speaker: "agent", text: "Tell me about a hard problem." },
      { turnIndex: 1, speaker: "candidate", text: "I built a migration and cut runtime by 90%." },
    ];
    routeState.rubricRows = [
      {
        profile_id: "profile_1",
        active_rubric_version_id: "rv_1",
        rubric: {
          bare_minimum_rule: "at_least_one_4_and_problem_solving_ge_3",
          recommendation_policy: { minimum_confidence: 0.75 },
        },
      },
    ];
    routeState.backfillRows = [
      { session_id: "sess_old_1" },
      { session_id: "sess_old_2" },
    ];
    routeState.upsertRowCount = 1;
    queryMock.mockClear();
    scoreTranscriptMock.mockClear();
    scoreTranscriptMock.mockResolvedValue({
      categoryScores: [
        {
          category: "problem_solving",
          score: 4,
          confidence: 0.9,
          evidenceQuotes: ["cut runtime by 90%"],
          rationale: "Specific high-impact migration.",
        },
        {
          category: "agency",
          score: 3,
          confidence: 0.84,
          evidenceQuotes: ["owned the migration"],
          rationale: "Shows ownership.",
        },
      ],
      warnings: [],
    });
  });

  afterEach(() => {
    if (previousBackendToken === undefined) {
      delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    } else {
      process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousBackendToken;
    }
  });

  it("loads a session transcript and active rubric before scoring", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/session/sess_1",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1" },
      });

      expect(res.statusCode).toBe(201);
      expect(sqlCalls.some((sql) => sql.includes("FROM sessions s WHERE s.session_id"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("FROM transcript_turns"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("role_grading_profiles"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("role_rubric_versions"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("interview_recommendations"))).toBe(true);
      expect(scoreTranscriptMock).toHaveBeenCalledWith(
        {
          rubric: routeState.rubricRows[0].rubric,
          transcriptTurns: routeState.transcriptRows,
        },
        expect.any(Object),
      );
    } finally {
      await app.close();
    }
  });

  it("stores recommendation output with deterministic recommendation value", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/session/sess_1",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().recommendation).toMatchObject({
        session_id: "sess_1",
        organization_id: "org_1",
        ashby_job_id: "job_1",
        rubric_version_id: "rv_1",
        source: "puddle_live",
        recommendation: "advance",
        confidence: 0.87,
        warnings: [],
        model_metadata: { provider: "bedrock", parser: "grading-scoring-v1" },
      });
      const insertCall = queryCalls.find((call) => call.sql.includes("INSERT INTO interview_recommendations"));
      expect(insertCall?.params[6]).toBe("advance");
      expect(insertCall?.params[8]).toBe(JSON.stringify([
        {
          category: "problem_solving",
          score: 4,
          confidence: 0.9,
          evidenceQuotes: ["cut runtime by 90%"],
          rationale: "Specific high-impact migration.",
        },
        {
          category: "agency",
          score: 3,
          confidence: 0.84,
          evidenceQuotes: ["owned the migration"],
          rationale: "Shows ownership.",
        },
      ]));
    } finally {
      await app.close();
    }
  });

  it("returns 409 when session has no transcript turns", async () => {
    routeState.transcriptRows = [];
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/session/sess_1",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "session transcript is not ready" });
      expect(scoreTranscriptMock).not.toHaveBeenCalled();
      expect(sqlCalls.some((sql) => sql.includes("INSERT INTO interview_recommendations"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("selects historical Fireflies source when the session came from Fireflies", async () => {
    routeState.sessionRows = [
      {
        session_id: "sess_1",
        org_id: "org_1",
        external_source: "fireflies",
        source_metadata: { ashby: { selected: { jobId: "job_1" } } },
        ashby_job_id: "job_1",
      },
    ];
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/session/sess_1",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().recommendation.source).toBe("historical_fireflies");
      const insertCall = queryCalls.find((call) => call.sql.includes("INSERT INTO interview_recommendations"));
      expect(insertCall?.params[5]).toBe("historical_fireflies");
    } finally {
      await app.close();
    }
  });

  it("normalizes missing model confidence conservatively before deterministic recommendation", async () => {
    scoreTranscriptMock.mockResolvedValue({
      categoryScores: [
        {
          category: "problem_solving",
          score: 4,
          evidenceQuotes: ["cut runtime by 90%"],
          rationale: "Specific high-impact migration.",
        },
      ],
      warnings: [],
    });
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/session/sess_1",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().recommendation).toMatchObject({
        recommendation: "hold",
        confidence: 0,
        warnings: ["low_confidence"],
      });
      const insertCall = queryCalls.find((call) => call.sql.includes("INSERT INTO interview_recommendations"));
      expect(insertCall?.params[8]).toBe(JSON.stringify([
        {
          category: "problem_solving",
          score: 4,
          evidenceQuotes: ["cut runtime by 90%"],
          rationale: "Specific high-impact migration.",
        },
      ]));
    } finally {
      await app.close();
    }
  });

  it("backfill route selects historical Fireflies sessions and returns queued IDs", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/backfill-historical",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1", ashbyJobId: "job_1", limit: 50 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ queued: ["sess_old_1", "sess_old_2"] });
      const backfillSql = sqlCalls.find((sql) => sql.includes("SELECT s.session_id FROM sessions s"));
      expect(backfillSql).toContain("sessions");
      expect(backfillSql).toContain("interview_recommendations");
      expect(backfillSql).toContain("external_source = 'fireflies'");
      expect(backfillSql).toContain("LIMIT $3");
      expect(queryCalls.find((call) => call.sql === backfillSql)?.params).toEqual(["org_1", "job_1", 25]);
    } finally {
      await app.close();
    }
  });
});
