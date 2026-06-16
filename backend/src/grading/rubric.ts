type AnchorMap = Record<1 | 2 | 3 | 4, string>;

export interface RoleRubricDimension {
  readonly key: string;
  readonly name: string;
  readonly meaning: string;
  readonly anchors: AnchorMap;
}

export interface RoleRubricQuestion {
  readonly question_id: string;
  readonly verbatim_text: string;
  readonly rubric_categories: readonly string[];
  readonly target_evidence: readonly string[];
}

export interface RoleRubric {
  readonly script_version: string;
  readonly role: {
    readonly organization_id: string;
    readonly ashby_job_id: string;
    readonly title: string;
  };
  readonly dimensions: readonly RoleRubricDimension[];
  readonly questions: readonly RoleRubricQuestion[];
  readonly bare_minimum_rule: "at_least_one_4_and_problem_solving_ge_3";
  readonly recommendation_thresholds: {
    readonly minimum_confidence: number;
  };
  readonly disallowed_signals: readonly string[];
  readonly generation_context: {
    readonly historical_session_count: number;
    readonly matched_application_count: number;
  };
}

export function buildDraftRubric(input: {
  readonly organizationId: string;
  readonly ashbyJobId: string;
  readonly jobName: string;
  readonly historicalSessionCount: number;
  readonly matchedApplicationCount: number;
}): RoleRubric {
  return {
    script_version: `${input.ashbyJobId}-v1`,
    role: {
      organization_id: input.organizationId,
      ashby_job_id: input.ashbyJobId,
      title: input.jobName,
    },
    dimensions: cloneDimensions(PILOT_DIMENSIONS),
    questions: cloneQuestions(PILOT_QUESTIONS),
    bare_minimum_rule: "at_least_one_4_and_problem_solving_ge_3",
    recommendation_thresholds: {
      minimum_confidence: 0.75,
    },
    disallowed_signals: [
      "appearance",
      "voice_quality",
      "accent",
      "emotion",
      "facial_expression",
      "race",
      "gender",
      "age",
      "disability",
    ],
    generation_context: {
      historical_session_count: input.historicalSessionCount,
      matched_application_count: input.matchedApplicationCount,
    },
  };
}

export function validateRoleRubric(value: unknown): { ok: true } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "Rubric must be an object." };
  }
  if (!isRecord(value.role) || !hasStringFields(value.role, ["organization_id", "ashby_job_id", "title"])) {
    return { ok: false, error: "Rubric role must define organization_id, ashby_job_id, and title." };
  }
  if (!Array.isArray(value.dimensions) || value.dimensions.length === 0) {
    return { ok: false, error: "Rubric must define at least one dimension." };
  }
  for (const dimension of value.dimensions) {
    if (!isRecord(dimension) || !hasStringFields(dimension, ["key", "name", "meaning"])) {
      return { ok: false, error: "Each rubric dimension must define key, name, and meaning." };
    }
    if (!hasAnchorSet(dimension.anchors)) {
      return { ok: false, error: "Each rubric dimension must define anchors 1, 2, 3, and 4." };
    }
  }
  if (!Array.isArray(value.questions) || value.questions.length === 0) {
    return { ok: false, error: "Rubric must define at least one question." };
  }
  for (const question of value.questions) {
    if (
      !isRecord(question) ||
      !hasStringFields(question, ["question_id", "verbatim_text"]) ||
      !isStringArray(question.rubric_categories) ||
      !isStringArray(question.target_evidence)
    ) {
      return { ok: false, error: "Each rubric question must define required string fields and evidence arrays." };
    }
  }
  if (value.bare_minimum_rule !== "at_least_one_4_and_problem_solving_ge_3") {
    return { ok: false, error: "Rubric bare minimum rule is invalid." };
  }
  if (!isRecord(value.recommendation_thresholds) || typeof value.recommendation_thresholds.minimum_confidence !== "number") {
    return { ok: false, error: "Rubric recommendation thresholds must define minimum_confidence." };
  }
  if (!isStringArray(value.disallowed_signals)) {
    return { ok: false, error: "Rubric disallowed_signals must be a string array." };
  }
  if (
    !isRecord(value.generation_context) ||
    typeof value.generation_context.historical_session_count !== "number" ||
    typeof value.generation_context.matched_application_count !== "number"
  ) {
    return { ok: false, error: "Rubric generation_context must define historical_session_count and matched_application_count." };
  }
  return { ok: true };
}

function hasAnchorSet(value: unknown): value is AnchorMap {
  if (!isRecord(value)) return false;
  return [1, 2, 3, 4].every((level) => typeof value[String(level)] === "string" || typeof value[level] === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasStringFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => typeof value[field] === "string");
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function cloneDimensions(dimensions: readonly RoleRubricDimension[]): RoleRubricDimension[] {
  return dimensions.map((dimension) => ({
    ...dimension,
    anchors: { ...dimension.anchors },
  }));
}

function cloneQuestions(questions: readonly RoleRubricQuestion[]): RoleRubricQuestion[] {
  return questions.map((question) => ({
    ...question,
    rubric_categories: [...question.rubric_categories],
    target_evidence: [...question.target_evidence],
  }));
}

const PILOT_DIMENSIONS: readonly RoleRubricDimension[] = [
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
    name: "Curious",
    meaning: "Needs to know the why behind everything, and acts on it.",
    anchors: {
      1: "Absence of curiosity.",
      2: "Signs of curiosity but no action.",
      3: "Very curious about something and takes action.",
      4: "Obsessively curious — becomes an expert.",
    },
  },
];

const PILOT_QUESTIONS: readonly RoleRubricQuestion[] = [
  {
    question_id: "q1",
    verbatim_text: "Can you tell me about a technically complex problem you solved with a clever or hacky solution?",
    rubric_categories: ["problem_solving"],
    target_evidence: [
      "the problem and why it was hard",
      "the solution and why it was clever or elegant",
      "the impact and level of recognition",
    ],
  },
  {
    question_id: "q2",
    verbatim_text: "Can you tell me about the time you hacked a non-computer system to your advantage?",
    rubric_categories: ["agency"],
    target_evidence: [
      "the system and the rules or norms in place",
      "what the candidate did and why it was unconventional",
      "the outcome and what it cost or risked",
    ],
  },
  {
    question_id: "q3",
    verbatim_text:
      "Can you tell me about an area of your life where your competitiveness became so intense that it cost you something? Maybe it was detrimental physically, mentally, or emotionally?",
    rubric_categories: ["competitiveness"],
    target_evidence: [
      "the area of life and what winning meant there",
      "how intense the competitiveness became",
      "the concrete cost the candidate paid",
    ],
  },
  {
    question_id: "q4",
    verbatim_text:
      "Can you tell me about a niche or obscure topic that no one knows about but you are an expert in? Meaning you are in the top 1% of this thing that is extremely niche?",
    rubric_categories: ["curious"],
    target_evidence: [
      "the topic and why it is niche",
      "how the candidate became an expert",
      "evidence of top-1% depth and sustained action",
    ],
  },
];
