type AnchorMap = Record<1 | 2 | 3 | 4, string>;

export type WeaveDimensionKey =
  | "problem_solving"
  | "agency"
  | "competitiveness"
  | "curious"
  | "communication"
  | "passion_for_sales";

export interface RoleRubricSubDimension {
  readonly key: string;
  readonly name: string;
  readonly anchors: AnchorMap;
}

export interface RoleRubricDimension {
  readonly key: WeaveDimensionKey;
  readonly name: string;
  readonly meaning: string;
  readonly anchors: AnchorMap;
  readonly sub_dimensions?: readonly RoleRubricSubDimension[];
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
  readonly bare_minimum_rule: "at_least_one_4_and_problem_solving_ge_3" | "at_least_one_4_and_average_ge_3";
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
  readonly dimensionKeys?: readonly WeaveDimensionKey[];
}): RoleRubric {
  const dimensionKeys = selectedDimensionKeys(input.dimensionKeys);
  return {
    script_version: `${input.ashbyJobId}-v1`,
    role: {
      organization_id: input.organizationId,
      ashby_job_id: input.ashbyJobId,
      title: input.jobName,
    },
    dimensions: cloneDimensions(dimensionKeys.map((key) => WEAVE_DIMENSION_LIBRARY[key])),
    questions: cloneQuestions(dimensionKeys.map((key) => WEAVE_QUESTION_LIBRARY[key])),
    bare_minimum_rule: dimensionKeys.includes("problem_solving")
      ? "at_least_one_4_and_problem_solving_ge_3"
      : "at_least_one_4_and_average_ge_3",
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
  if (!Array.isArray(value.dimensions)) {
    return { ok: false, error: "Rubric must define at least one dimension." };
  }
  if (value.dimensions.length < 3 || value.dimensions.length > 6) {
    return { ok: false, error: "Rubric must define between 3 and 6 dimensions." };
  }
  const seenDimensionKeys = new Set<string>();
  for (const dimension of value.dimensions) {
    if (!isRecord(dimension)) {
      return { ok: false, error: "Each rubric dimension must define key, name, and meaning." };
    }
    const { key, name, meaning, anchors, sub_dimensions: subDimensions } = dimension;
    if (typeof key !== "string" || typeof name !== "string" || typeof meaning !== "string") {
      return { ok: false, error: "Each rubric dimension must define key, name, and meaning." };
    }
    if (!isWeaveDimensionKey(key)) {
      return { ok: false, error: "Rubric dimension key is not in the Weave dimension library." };
    }
    if (seenDimensionKeys.has(key)) {
      return { ok: false, error: "Rubric dimension keys must be unique." };
    }
    seenDimensionKeys.add(key);
    if (!hasAnchorSet(anchors)) {
      return { ok: false, error: "Each rubric dimension must define anchors 1, 2, 3, and 4." };
    }
    if (Array.isArray(subDimensions)) {
      for (const subDimension of subDimensions) {
        if (
          !isRecord(subDimension) ||
          !hasStringFields(subDimension, ["key", "name"]) ||
          !hasAnchorSet(subDimension.anchors)
        ) {
          return {
            ok: false,
            error: "Each rubric sub-dimension must define key, name, and anchors 1, 2, 3, and 4.",
          };
        }
      }
    }
    if (containsAccentLanguage({ key, meaning, anchors, sub_dimensions: subDimensions })) {
      return { ok: false, error: "Communication rubric must not score accent." };
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
    if (question.rubric_categories.some((category) => !seenDimensionKeys.has(category))) {
      return { ok: false, error: "Rubric questions must reference selected dimensions." };
    }
  }
  if (
    value.bare_minimum_rule !== "at_least_one_4_and_problem_solving_ge_3" &&
    value.bare_minimum_rule !== "at_least_one_4_and_average_ge_3"
  ) {
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

const DEFAULT_DIMENSION_KEYS: readonly WeaveDimensionKey[] = [
  "problem_solving",
  "agency",
  "competitiveness",
  "curious",
];

const WEAVE_DIMENSION_KEY_SET = new Set<WeaveDimensionKey>([
  "problem_solving",
  "agency",
  "competitiveness",
  "curious",
  "communication",
  "passion_for_sales",
]);

function selectedDimensionKeys(value: readonly WeaveDimensionKey[] | undefined): readonly WeaveDimensionKey[] {
  return value && value.length > 0 ? value : DEFAULT_DIMENSION_KEYS;
}

function isWeaveDimensionKey(value: string): value is WeaveDimensionKey {
  return WEAVE_DIMENSION_KEY_SET.has(value as WeaveDimensionKey);
}

function containsAccentLanguage(dimension: {
  readonly key: WeaveDimensionKey;
  readonly meaning: string;
  readonly anchors: AnchorMap;
  readonly sub_dimensions: unknown;
}): boolean {
  if (dimension.key !== "communication") {
    return false;
  }
  const values = [
    dimension.meaning,
    ...Object.values(dimension.anchors),
    ...(Array.isArray(dimension.sub_dimensions)
      ? dimension.sub_dimensions.flatMap((subDimension) =>
          isRecord(subDimension) && hasAnchorSet(subDimension.anchors) ? Object.values(subDimension.anchors) : [],
        )
      : []),
  ];
  return values.some((text) => /\baccent\b/i.test(text));
}

function cloneDimensions(dimensions: readonly RoleRubricDimension[]): RoleRubricDimension[] {
  return dimensions.map((dimension) => ({
    ...dimension,
    anchors: { ...dimension.anchors },
    ...(dimension.sub_dimensions
      ? {
          sub_dimensions: dimension.sub_dimensions.map((subDimension) => ({
            ...subDimension,
            anchors: { ...subDimension.anchors },
          })),
        }
      : {}),
  }));
}

function cloneQuestions(questions: readonly RoleRubricQuestion[]): RoleRubricQuestion[] {
  return questions.map((question) => ({
    ...question,
    rubric_categories: [...question.rubric_categories],
    target_evidence: [...question.target_evidence],
  }));
}

const WEAVE_DIMENSION_LIBRARY: Record<WeaveDimensionKey, RoleRubricDimension> = {
  problem_solving: {
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
  agency: {
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
  competitiveness: {
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
  curious: {
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
  communication: {
    key: "communication",
    name: "Communication",
    meaning: "Engages in conversation by listening, understanding, and articulating themselves.",
    anchors: {
      1: "Choppy, incomprehensible, or hard to follow.",
      2: "Articulates themselves well.",
      3: "Enjoyable to talk to and articulates themselves well.",
      4: "Asks clarifying questions, enjoyable to talk to, and articulates themselves clearly.",
    },
  },
  passion_for_sales: {
    key: "passion_for_sales",
    name: "Passion for Sales",
    meaning: "Figures out a way to be at the top of the leaderboard.",
    anchors: {
      1: "Weak sales motivation, weak sales preparation, and weak performance evidence.",
      2: "Some sales exposure or motivation, with limited training or performance evidence.",
      3: "Strong sales motivation, training, or top-performer evidence across multiple sub-dimensions.",
      4: "Exceptional sales drive with high-end evidence across reason, background, and performance.",
    },
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
  },
};

const WEAVE_QUESTION_LIBRARY: Record<WeaveDimensionKey, RoleRubricQuestion> = {
  problem_solving: {
    question_id: "problem_solving",
    verbatim_text: "Can you tell me about a technically complex problem you solved with a clever or hacky solution?",
    rubric_categories: ["problem_solving"],
    target_evidence: [
      "the problem and why it was hard",
      "the solution and why it was clever or elegant",
      "the impact and level of recognition",
    ],
  },
  agency: {
    question_id: "agency",
    verbatim_text: "Can you tell me about the time you hacked a non-computer system to your advantage?",
    rubric_categories: ["agency"],
    target_evidence: [
      "the system and the rules or norms in place",
      "what the candidate did and why it was unconventional",
      "the outcome and what it cost or risked",
    ],
  },
  competitiveness: {
    question_id: "competitiveness",
    verbatim_text: "Can you tell me about an area of your life where your competitiveness became so intense that it cost you something?",
    rubric_categories: ["competitiveness"],
    target_evidence: [
      "the area of life and what winning meant there",
      "how intense the competitiveness became",
      "the concrete cost the candidate paid",
    ],
  },
  curious: {
    question_id: "curious",
    verbatim_text: "Can you tell me about a niche or obscure topic that no one knows about but you are an expert in?",
    rubric_categories: ["curious"],
    target_evidence: [
      "the topic and why it is niche",
      "how the candidate became an expert",
      "evidence of top-1% depth and sustained action",
    ],
  },
  communication: {
    question_id: "communication",
    verbatim_text: "How do you usually make sure a conversation is useful for both sides?",
    rubric_categories: ["communication"],
    target_evidence: [
      "whether the candidate answers directly",
      "whether the candidate clarifies before answering when needed",
      "whether the answer is concise and easy to follow",
    ],
  },
  passion_for_sales: {
    question_id: "passion_for_sales",
    verbatim_text: "Why did you get into sales, how did you learn how to sell, and where has that led you today?",
    rubric_categories: ["passion_for_sales"],
    target_evidence: [
      "reason for getting into sales",
      "professional sales background and training",
      "performance as a salesperson",
    ],
  },
};
