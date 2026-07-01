import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

const {
  queryMock,
  scoreTranscriptMock,
  sqlCalls,
  queryCalls,
  routeState,
  defaultScorecard,
  bedrockConstructorConfigs,
  openaiConstructorConfigs,
  bedrockModelInstances,
  openaiModelInstances,
} = vi.hoisted(() => {
  const sqlCalls: string[] = [];
  const queryCalls: Array<{ readonly sql: string; readonly params: readonly unknown[] }> = [];
  const bedrockConstructorConfigs: unknown[] = [];
  const openaiConstructorConfigs: unknown[] = [];
  const bedrockModelInstances: unknown[] = [];
  const openaiModelInstances: unknown[] = [];
  const defaultScorecard = {
    version: "company_scorecard_v1",
    dimensionScores: [
      {
        category: "problem_solving",
        score: 4,
        confidence: 0.9,
        notes: "Specific high-impact migration.",
        evidenceQuotes: ["cut runtime by 90%"],
      },
      {
        category: "agency",
        score: 3,
        confidence: 0.84,
        notes: "Shows ownership.",
        evidenceQuotes: ["owned the migration"],
      },
    ],
    missingQuestions: [
      {
        question: "Niche curiosity question",
        asked: "no",
        notes: "The transcript did not include the curiosity calibration question.",
      },
    ],
    scriptedAnswerDetection: {
      signals: [{ signal: "Scripted / rehearsed likelihood", rating: "Low" }],
      summary: "Specific, imperfect answers with low scripted risk.",
      confidence: "5-10%",
    },
    finalScores: {
      dimensions: [
        { category: "problem_solving", score: 4 },
        { category: "agency", score: 3 },
      ],
      totalScore: 7,
      maxScore: 8,
    },
    comment: "Strong PS and solid agency.",
  };
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
    scorecard: defaultScorecard,
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
                scorecard_json: JSON.parse(String(params[10])),
                warnings: JSON.parse(String(params[11])),
                model_metadata: JSON.parse(String(params[12])),
              },
            ],
        rowCount: routeState.upsertRowCount,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  return {
    queryMock,
    scoreTranscriptMock,
    sqlCalls,
    queryCalls,
    routeState,
    defaultScorecard,
    bedrockConstructorConfigs,
    openaiConstructorConfigs,
    bedrockModelInstances,
    openaiModelInstances,
  };
});

vi.mock("../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock }),
}));

vi.mock("../src/grading/scoring.js", () => ({
  scoreTranscript: scoreTranscriptMock,
}));

vi.mock("../src/grading/bedrock.js", () => ({
  BedrockGradingModel: class FakeBedrockGradingModel {
    constructor(config?: unknown) {
      bedrockConstructorConfigs.push(config);
      bedrockModelInstances.push(this);
    }
  },
}));

vi.mock("../src/grading/openai.js", () => ({
  OpenAIGradingModel: class FakeOpenAIGradingModel {
    constructor(config?: unknown) {
      openaiConstructorConfigs.push(config);
      openaiModelInstances.push(this);
    }
  },
}));

const FAKE_LK = { host: "wss://example", apiKey: "key", apiSecret: "secret" };
const previousBackendToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
const previousProvider = process.env.PUDDLE_GRADING_MODEL_PROVIDER;
const previousModelId = process.env.PUDDLE_GRADING_MODEL_ID;
const previousReasoningEffort = process.env.PUDDLE_GRADING_OPENAI_REASONING_EFFORT;
const previousVerbosity = process.env.PUDDLE_GRADING_OPENAI_VERBOSITY;
const previousAwsRegion = process.env.AWS_REGION;

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("grading session recommendations", () => {
  beforeEach(() => {
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    delete process.env.PUDDLE_GRADING_MODEL_PROVIDER;
    delete process.env.PUDDLE_GRADING_MODEL_ID;
    delete process.env.PUDDLE_GRADING_OPENAI_REASONING_EFFORT;
    delete process.env.PUDDLE_GRADING_OPENAI_VERBOSITY;
    delete process.env.AWS_REGION;
    sqlCalls.length = 0;
    queryCalls.length = 0;
    bedrockConstructorConfigs.length = 0;
    openaiConstructorConfigs.length = 0;
    bedrockModelInstances.length = 0;
    openaiModelInstances.length = 0;
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
      scorecard: defaultScorecard,
      warnings: [],
    });
  });

  afterEach(() => {
    restoreEnvValue("PUDDLE_BACKEND_INTERNAL_TOKEN", previousBackendToken);
    restoreEnvValue("PUDDLE_GRADING_MODEL_PROVIDER", previousProvider);
    restoreEnvValue("PUDDLE_GRADING_MODEL_ID", previousModelId);
    restoreEnvValue("PUDDLE_GRADING_OPENAI_REASONING_EFFORT", previousReasoningEffort);
    restoreEnvValue("PUDDLE_GRADING_OPENAI_VERBOSITY", previousVerbosity);
    restoreEnvValue("AWS_REGION", previousAwsRegion);
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
        expect.objectContaining({
          rubric: routeState.rubricRows[0].rubric,
          transcriptTurns: routeState.transcriptRows,
          gradingGuide: expect.stringContaining("Missing question neutral default"),
          calibrationExamples: expect.arrayContaining([
            expect.objectContaining({ id: "example_a" }),
          ]),
          dimensionScoreAnchors: expect.objectContaining({
            problem_solving: expect.objectContaining({
              "1": expect.any(Array),
              "2": expect.any(Array),
              "3": expect.any(Array),
              "4": expect.any(Array),
            }),
          }),
        }),
        expect.any(Object),
      );
      expect(scoreTranscriptMock.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          rubric: routeState.rubricRows[0].rubric,
        }),
      );
    } finally {
      await app.close();
    }
  });

  it("passes a sales role rubric through to scoring unchanged", async () => {
    routeState.rubricRows = [
      {
        profile_id: "profile_sales",
        active_rubric_version_id: "rv_sales",
        rubric: {
          script_version: "job_1-v1",
          role: { organization_id: "org_1", ashby_job_id: "job_1", title: "Account Executive" },
          dimensions: [
            { key: "communication", name: "Communication", meaning: "Clear conversation.", anchors: { 1: "Low", 2: "Clear", 3: "Enjoyable", 4: "Clarifying" } },
            { key: "passion_for_sales", name: "Passion for Sales", meaning: "Leaderboard drive.", anchors: { 1: "Low", 2: "Some", 3: "Strong", 4: "Exceptional" } },
            { key: "agency", name: "Agency", meaning: "Stops at nothing.", anchors: { 1: "Low", 2: "Expected", 3: "Extra", 4: "Rules hack" } },
          ],
          bare_minimum_rule: "at_least_one_4_and_average_ge_3",
          recommendation_thresholds: { minimum_confidence: 0.75 },
          disallowed_signals: ["accent"],
          generation_context: { historical_session_count: 0, matched_application_count: 0 },
        },
      },
    ];
    scoreTranscriptMock.mockResolvedValue({
      categoryScores: [
        { category: "communication", score: 3, confidence: 0.9, evidenceQuotes: ["quote"], rationale: "Clear." },
        { category: "passion_for_sales", score: 4, confidence: 0.86, evidenceQuotes: ["quote"], rationale: "Driven." },
        { category: "agency", score: 3, confidence: 0.84, evidenceQuotes: ["quote"], rationale: "Persistent." },
      ],
      scorecard: {
        ...defaultScorecard,
        dimensionScores: [
          { category: "communication", score: 3, confidence: 0.9, notes: "Clear.", evidenceQuotes: ["quote"] },
          { category: "passion_for_sales", score: 4, confidence: 0.86, notes: "Driven.", evidenceQuotes: ["quote"] },
          { category: "agency", score: 3, confidence: 0.84, notes: "Persistent.", evidenceQuotes: ["quote"] },
        ],
        finalScores: {
          dimensions: [
            { category: "communication", score: 3 },
            { category: "passion_for_sales", score: 4 },
            { category: "agency", score: 3 },
          ],
          totalScore: 10,
          maxScore: 12,
        },
      },
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
      expect(scoreTranscriptMock.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ rubric: routeState.rubricRows[0].rubric }),
      );
      expect(res.json().recommendation).toMatchObject({
        rubric_version_id: "rv_sales",
        recommendation: "advance",
      });
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
        scorecard_json: defaultScorecard,
        model_metadata: {
          provider: "bedrock",
          region: "us-east-1",
          modelId: "us.anthropic.claude-opus-4-8",
          parser: "grading-scorecard-v1",
        },
      });
      expect(bedrockConstructorConfigs).toEqual([
        { region: "us-east-1", modelId: "us.anthropic.claude-opus-4-8" },
      ]);
      expect(openaiConstructorConfigs).toEqual([]);
      expect(scoreTranscriptMock.mock.calls[0]?.[1]).toBe(bedrockModelInstances[0]);
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
      expect(insertCall?.params[10]).toBe(JSON.stringify(defaultScorecard));
    } finally {
      await app.close();
    }
  });

  it("uses OpenAI provider env controls and stores OpenAI model metadata", async () => {
    process.env.PUDDLE_GRADING_MODEL_PROVIDER = "openai";
    process.env.PUDDLE_GRADING_MODEL_ID = "gpt-prod-grader";
    process.env.PUDDLE_GRADING_OPENAI_REASONING_EFFORT = "medium";
    process.env.PUDDLE_GRADING_OPENAI_VERBOSITY = "high";

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/session/sess_1",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1" },
      });

      expect(res.statusCode).toBe(201);
      expect(openaiConstructorConfigs).toEqual([
        {
          modelId: "gpt-prod-grader",
          reasoningEffort: "medium",
          verbosity: "high",
        },
      ]);
      expect(bedrockConstructorConfigs).toEqual([]);
      expect(scoreTranscriptMock.mock.calls[0]?.[1]).toBe(openaiModelInstances[0]);
      expect(res.json().recommendation.model_metadata).toEqual({
        provider: "openai",
        modelId: "gpt-prod-grader",
        reasoningEffort: "medium",
        verbosity: "high",
        parser: "grading-scorecard-v1",
      });
      const insertCall = queryCalls.find((call) => call.sql.includes("INSERT INTO interview_recommendations"));
      expect(JSON.parse(String(insertCall?.params[12]))).toEqual({
        provider: "openai",
        modelId: "gpt-prod-grader",
        reasoningEffort: "medium",
        verbosity: "high",
        parser: "grading-scorecard-v1",
      });
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

  it("rejects missing organization id before querying session recommendations", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/session/sess_1",
        headers: { "content-type": "application/json" },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "organizationId is required" });
      expect(sqlCalls).toEqual([]);
      expect(scoreTranscriptMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("returns 404 when no session row exists", async () => {
    routeState.sessionRows = [];
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/session/sess_1",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "session not found" });
      expect(sqlCalls.some((sql) => sql.includes("FROM sessions s WHERE s.session_id"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("FROM transcript_turns"))).toBe(false);
      expect(scoreTranscriptMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("returns 409 when an existing session is missing Ashby job id", async () => {
    routeState.sessionRows = [
      {
        session_id: "sess_1",
        org_id: "org_1",
        external_source: "puddle_live",
        source_metadata: {},
        ashby_job_id: " ",
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

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "session is missing ashbyJobId" });
      expect(sqlCalls.some((sql) => sql.includes("FROM transcript_turns"))).toBe(false);
      expect(scoreTranscriptMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("returns 409 when no active rubric exists", async () => {
    routeState.rubricRows = [];
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/session/sess_1",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "active rubric is required" });
      expect(sqlCalls.some((sql) => sql.includes("role_grading_profiles"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("INSERT INTO interview_recommendations"))).toBe(false);
      expect(scoreTranscriptMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("returns 409 when recommendation upsert returns no row", async () => {
    routeState.upsertRowCount = 0;
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/session/sess_1",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "recommendation could not be stored" });
      expect(scoreTranscriptMock).toHaveBeenCalledOnce();
      expect(sqlCalls.some((sql) => sql.includes("INSERT INTO interview_recommendations"))).toBe(true);
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
      scorecard: {
        ...defaultScorecard,
        dimensionScores: [
          {
            category: "problem_solving",
            score: 4,
            notes: "Specific high-impact migration.",
            evidenceQuotes: ["cut runtime by 90%"],
          },
        ],
        finalScores: {
          dimensions: [{ category: "problem_solving", score: 4 }],
          totalScore: 4,
          maxScore: 4,
        },
      },
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

  it("backfill route defaults to limit 10 when omitted", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/backfill-historical",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1", ashbyJobId: "job_1" },
      });

      expect(res.statusCode).toBe(200);
      const backfillCall = queryCalls.find((call) => call.sql.includes("SELECT s.session_id FROM sessions s"));
      expect(backfillCall?.params).toEqual(["org_1", "job_1", 10]);
    } finally {
      await app.close();
    }
  });

  it("backfill route rejects negative limits", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/backfill-historical",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1", ashbyJobId: "job_1", limit: -1 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "limit must be a finite non-negative integer" });
      expect(sqlCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("backfill route rejects non-integer limits", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/backfill-historical",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1", ashbyJobId: "job_1", limit: 1.5 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "limit must be a finite non-negative integer" });
      expect(sqlCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("backfill route accepts zero limit", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/backfill-historical",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1", ashbyJobId: "job_1", limit: 0 },
      });

      expect(res.statusCode).toBe(200);
      const backfillCall = queryCalls.find((call) => call.sql.includes("SELECT s.session_id FROM sessions s"));
      expect(backfillCall?.params).toEqual(["org_1", "job_1", 0]);
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
