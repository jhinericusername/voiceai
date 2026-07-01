import { describe, expect, it } from "vitest";
import { buildDraftRubric, validateRoleRubric } from "../src/grading/rubric.js";

describe("grading rubric", () => {
  it("builds a draft rubric from the pilot rubric and job context", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });

    expect(draft.script_version).toBe("job_1-v1");
    expect(draft.role.title).toBe("Founding AI Engineer");
    expect(draft.dimensions).toEqual([
      {
        key: "problem_solving",
        name: "Problem Solving",
        meaning: "Finds clever, elegant solutions to hard problems.",
        anchors: {
          1: "Downvoted.",
          2: "Found a solution alongside others.",
          3: "Accepted answer on Stack Overflow.",
          4: "Front page on Hacker News.",
        },
      },
      {
        key: "agency",
        name: "Agency",
        meaning: "Stops at nothing to solve a problem.",
        anchors: {
          1: "Does not meet expectations.",
          2: "Does everything expected or asked.",
          3: "Puts in more effort than expected.",
          4: "Hacked or broke rules to solve the problem.",
        },
      },
      {
        key: "competitiveness",
        name: "Competitiveness",
        meaning: "Gets consumed by a desire to win.",
        anchors: {
          1: "Absence of competitiveness.",
          2: "Does not like to lose.",
          3: "Emotionally affected by losing.",
          4: "Competitive to a detrimental degree in some facet of life.",
        },
      },
      {
        key: "curious",
        name: "Curiosity",
        meaning: "Needs to know the why behind everything, and acts on it.",
        anchors: {
          1: "Absence of curiosity.",
          2: "Signs of curiosity but no action.",
          3: "Very curious about something and takes action.",
          4: "Obsessively curious, becomes an expert.",
        },
      },
    ]);
    expect(draft.questions.map((question) => question.verbatim_text)).toEqual([
      "Can you tell me about a technically complex problem you solved with a clever or hacky solution?",
      "Can you tell me about the time you hacked a non-computer system to your advantage?",
      "Can you tell me about an area of your life where your competitiveness became so intense that it cost you something?",
      "Can you tell me about a niche or obscure topic that no one knows about but you are an expert in?",
    ]);
    expect(draft.disallowed_signals).toEqual([
      "appearance",
      "voice_quality",
      "accent",
      "emotion",
      "facial_expression",
      "race",
      "gender",
      "age",
      "disability",
    ]);
    expect(draft.recommendation_thresholds.minimum_confidence).toBe(0.75);
    expect(draft.generation_context.historical_session_count).toBe(12);
    expect(draft.generation_context.matched_application_count).toBe(10);
  });

  it("validates a complete rubric", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });

    expect(validateRoleRubric(draft)).toEqual({ ok: true });
  });

  it("builds a selected-dimension draft rubric with Communication and Passion for Sales", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_sales",
      jobName: "Account Executive",
      historicalSessionCount: 7,
      matchedApplicationCount: 6,
      dimensionKeys: ["communication", "passion_for_sales", "agency"],
    });

    expect(draft.dimensions.map((dimension) => dimension.key)).toEqual([
      "communication",
      "passion_for_sales",
      "agency",
    ]);
    expect(draft.dimensions.find((dimension) => dimension.key === "communication")).toMatchObject({
      name: "Communication",
      meaning: "Engages in conversation by listening, understanding, and articulating themselves.",
      anchors: {
        1: "Choppy, incomprehensible, or hard to follow.",
        2: "Articulates themselves well.",
        3: "Enjoyable to talk to and articulates themselves well.",
        4: "Asks clarifying questions, enjoyable to talk to, and articulates themselves clearly.",
      },
    });
    expect(draft.dimensions.find((dimension) => dimension.key === "passion_for_sales")).toMatchObject({
      name: "Passion for Sales",
      sub_dimensions: [
        {
          key: "reason_for_getting_into_sales",
          name: "Reason for Getting Into Sales",
          anchors: {
            1: "Fell into it.",
            2: "Family in sales.",
            3: "Founder-oriented or personally interested.",
            4: "Money-motivated.",
          },
        },
        {
          key: "professional_sales_background",
          name: "Professional Sales Background",
          anchors: {
            1: "No training.",
            2: "Self-taught.",
            3: "Formal training.",
            4: "Self-taught plus formal training.",
          },
        },
        {
          key: "performance_as_salesperson",
          name: "Performance as a Salesperson",
          anchors: {
            1: "No promotions or job hopping.",
            2: "Some promotions or promotions due to tenure.",
            3: "Top performer and bored.",
            4: "Cannot be promoted.",
          },
        },
      ],
    });
    expect(draft.questions.map((question) => question.rubric_categories)).toEqual([
      ["communication"],
      ["passion_for_sales"],
      ["agency"],
    ]);
    expect(validateRoleRubric(draft)).toEqual({ ok: true });
  });

  it("rejects role rubrics outside the 3 to 6 dimension range", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Account Executive",
      historicalSessionCount: 1,
      matchedApplicationCount: 1,
      dimensionKeys: ["communication", "agency", "passion_for_sales"],
    });

    expect(validateRoleRubric({ ...draft, dimensions: draft.dimensions.slice(0, 2) })).toEqual({
      ok: false,
      error: "Rubric must define between 3 and 6 dimensions.",
    });

    expect(validateRoleRubric({ ...draft, dimensions: [...draft.dimensions, ...draft.dimensions, draft.dimensions[0]] })).toEqual({
      ok: false,
      error: "Rubric must define between 3 and 6 dimensions.",
    });
  });

  it("rejects unknown, duplicate, and accent-based dimensions", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Account Executive",
      historicalSessionCount: 1,
      matchedApplicationCount: 1,
      dimensionKeys: ["communication", "agency", "passion_for_sales"],
    });

    expect(validateRoleRubric({
      ...draft,
      dimensions: [
        { ...draft.dimensions[0], key: "unknown_dimension" },
        draft.dimensions[1],
        draft.dimensions[2],
      ],
    })).toEqual({
      ok: false,
      error: "Rubric dimension key is not in the Weave dimension library.",
    });

    expect(validateRoleRubric({
      ...draft,
      dimensions: [draft.dimensions[0], { ...draft.dimensions[0] }, draft.dimensions[2]],
    })).toEqual({
      ok: false,
      error: "Rubric dimension keys must be unique.",
    });

    expect(validateRoleRubric({
      ...draft,
      dimensions: [
        {
          ...draft.dimensions[0],
          anchors: { ...draft.dimensions[0].anchors, 1: "Choppy with heavy accent." },
        },
        draft.dimensions[1],
        draft.dimensions[2],
      ],
    })).toEqual({
      ok: false,
      error: "Communication rubric must not score accent.",
    });
  });

  it("rejects malformed Passion for Sales sub-dimension anchors", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Account Executive",
      historicalSessionCount: 1,
      matchedApplicationCount: 1,
      dimensionKeys: ["communication", "agency", "passion_for_sales"],
    });
    const passion = draft.dimensions.find((dimension) => dimension.key === "passion_for_sales");

    expect(validateRoleRubric({
      ...draft,
      dimensions: draft.dimensions.map((dimension) =>
        dimension.key === "passion_for_sales"
          ? {
              ...dimension,
              sub_dimensions: [
                {
                  ...passion?.sub_dimensions?.[0],
                  anchors: { 1: "Only one anchor." },
                },
              ],
            }
          : dimension,
      ),
    })).toEqual({
      ok: false,
      error: "Each rubric sub-dimension must define key, name, and anchors 1, 2, 3, and 4.",
    });
  });

  it("rejects questions that reference dimensions not selected by the rubric", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Account Executive",
      historicalSessionCount: 1,
      matchedApplicationCount: 1,
      dimensionKeys: ["communication", "agency", "passion_for_sales"],
    });

    expect(validateRoleRubric({
      ...draft,
      questions: [
        {
          ...draft.questions[0],
          rubric_categories: ["problem_solving"],
        },
        draft.questions[1],
        draft.questions[2],
      ],
    })).toEqual({
      ok: false,
      error: "Rubric questions must reference selected dimensions.",
    });
  });

  it("rejects rubrics without anchors", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });
    const invalid = {
      ...draft,
      dimensions: [{ ...draft.dimensions[0], anchors: { 1: "Only one" } }, ...draft.dimensions.slice(1)],
    };

    expect(validateRoleRubric(invalid)).toEqual({
      ok: false,
      error: "Each rubric dimension must define anchors 1, 2, 3, and 4.",
    });
  });

  it("rejects malformed required fields", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });
    const invalid = {
      ...draft,
      questions: [{ ...draft.questions[0], target_evidence: ["valid", 42] }],
    };

    expect(validateRoleRubric(invalid)).toEqual({
      ok: false,
      error: "Each rubric question must define required string fields and evidence arrays.",
    });
  });

  it("does not share mutable nested references between draft calls", () => {
    const first = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });

    (first.dimensions[0].anchors as Record<number, string>)[4] = "Mutated anchor";
    (first.questions[0].rubric_categories as string[]).push("mutated_category");
    (first.questions[0].target_evidence as string[]).push("mutated evidence");

    const second = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });

    expect(second.dimensions[0].anchors[4]).toBe("Front page on Hacker News.");
    expect(second.questions[0].rubric_categories).toEqual(["problem_solving"]);
    expect(second.questions[0].target_evidence).toEqual([
      "the problem and why it was hard",
      "the solution and why it was clever or elegant",
      "the impact and level of recognition",
    ]);
  });
});
