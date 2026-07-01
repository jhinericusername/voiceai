import type { RoleRubric, RoleRubricDimension, RoleRubricQuestion } from "../../backend-data";

export const weaveDimensionKeys = [
  "problem_solving",
  "agency",
  "competitiveness",
  "curious",
  "communication",
  "passion_for_sales",
] as const;

export type WeaveDimensionKey = (typeof weaveDimensionKeys)[number];

export const defaultSelectedDimensionKeys: readonly WeaveDimensionKey[] = [
  "problem_solving",
  "agency",
  "competitiveness",
  "curious",
];

export const weaveDimensionLibrary: Record<WeaveDimensionKey, RoleRubricDimension> = {
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

const questionLibrary: Record<WeaveDimensionKey, RoleRubricQuestion> = {
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
    verbatim_text:
      "Can you tell me about an area of your life where your competitiveness became so intense that it cost you something?",
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

const weaveDimensionKeySet = new Set<string>(weaveDimensionKeys);

function isWeaveDimensionKey(value: string): value is WeaveDimensionKey {
  return weaveDimensionKeySet.has(value);
}

export function cloneRoleRubricDimension(dimension: RoleRubricDimension): RoleRubricDimension {
  return {
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
  };
}

function cloneRoleRubricQuestion(question: RoleRubricQuestion): RoleRubricQuestion {
  return {
    ...question,
    rubric_categories: [...question.rubric_categories],
    target_evidence: [...question.target_evidence],
  };
}

function selectedKnownKeys(dimensions: readonly RoleRubricDimension[]): WeaveDimensionKey[] {
  return dimensions.flatMap((dimension) => (isWeaveDimensionKey(dimension.key) ? [dimension.key] : []));
}

export function buildRoleRubric(input: {
  readonly organizationId: string;
  readonly ashbyJobId: string;
  readonly title: string;
  readonly dimensions: readonly RoleRubricDimension[];
  readonly historicalSessionCount?: number | null;
  readonly matchedApplicationCount?: number | null;
}): RoleRubric {
  const selectedKeys = selectedKnownKeys(input.dimensions);
  return {
    script_version: `${input.ashbyJobId}-v1`,
    role: {
      organization_id: input.organizationId,
      ashby_job_id: input.ashbyJobId,
      title: input.title,
    },
    dimensions: input.dimensions.map(cloneRoleRubricDimension),
    questions: selectedKeys.map((key) => cloneRoleRubricQuestion(questionLibrary[key])),
    bare_minimum_rule: selectedKeys.includes("problem_solving")
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
      historical_session_count: input.historicalSessionCount ?? 0,
      matched_application_count: input.matchedApplicationCount ?? 0,
    },
  };
}

export function initialDimensions(rubric: RoleRubric | null): RoleRubricDimension[] {
  if (rubric?.dimensions.length) {
    return rubric.dimensions.map(cloneRoleRubricDimension);
  }

  return defaultSelectedDimensionKeys.map((key) => cloneRoleRubricDimension(weaveDimensionLibrary[key]));
}

export function selectedDimensionError(dimensions: readonly RoleRubricDimension[]): string | null {
  if (dimensions.length < 3) {
    return "Select at least 3 dimensions.";
  }
  if (dimensions.length > 6) {
    return "Select no more than 6 dimensions.";
  }
  return null;
}
