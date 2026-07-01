# Role Rubrics V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build persisted, editable role rubrics and inject the active role rubric into grading prompts based on the candidate's Ashby role.

**Architecture:** The backend remains the source of truth for rubric JSON validation, versioning, and recommendation scoring. The platform loads role grading state server-side for page render, then uses WorkOS-gated dashboard API routes for draft save and approval. The Rubric tab is a focused client editor that renders active or draft rubric state for the selected Ashby role.

**Tech Stack:** TypeScript, Fastify, Postgres JSONB, Vitest, Next.js 16 App Router, React 19, WorkOS AuthKit, Node test runner.

---

## File Structure

Backend:

- Modify `backend/src/grading/rubric.ts`: extend rubric types, add Weave dimension library, add selected-dimension draft building, validate 3-6 known dimensions, validate sub-dimensions, block accent-scoring language.
- Modify `backend/src/grading/routes.ts`: let `/grading/profiles/:profileId/draft` persist a submitted full rubric as a new draft version.
- Modify `backend/src/grading/scoring.ts`: add explicit role-rubric prompt instructions and selected-dimension extraction.
- Modify `backend/src/grading/evaluation/calibration.ts`: remove "exactly four dimensions" language from the default grading guide so role rubrics can vary.
- Modify `backend/src/grading/recommendation.ts`: add a general role-rubric rule so rubrics without `problem_solving` can still produce advance or pass decisions.
- Test `backend/test/grading-rubric.test.ts`.
- Test `backend/test/grading-routes.test.ts`.
- Test `backend/test/grading-scoring.test.ts`.
- Test `backend/test/grading-recommendation.test.ts`.
- Test `backend/test/grading-session-recommendations.test.ts`.

Platform:

- Modify `platform/app/dashboard/backend-data.ts`: add grading profile and rubric types plus `getGradingCompanyState`.
- Create `platform/app/api/grading/company-state/route.ts`: WorkOS-gated proxy for company grading state.
- Create `platform/app/api/grading/profiles/[profileId]/draft/route.ts`: WorkOS-gated proxy for draft save.
- Create `platform/app/api/grading/profiles/[profileId]/approve/route.ts`: WorkOS-gated proxy for draft approval.
- Create `platform/app/dashboard/roles/[roleId]/role-rubric-model.ts`: client-safe Weave dimension library and rubric construction helpers.
- Create `platform/app/dashboard/roles/[roleId]/RoleRubricEditor.tsx`: client editor for selection, anchors, sub-dimensions, save, and approve.
- Modify `platform/app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx`: pass selected role grading profile into the Rubric tab and render the editor.
- Modify `platform/app/dashboard/roles/[roleId]/page.tsx`: server-load grading state and pass matching profile to tabs.
- Test `platform/tests/dashboard-foundation-source.test.mjs`.
- Test `platform/tests/org-access-source.test.mjs`.
- Add test `platform/tests/role-rubric-source.test.mjs`.

Manual gate:

- Do not run migrations, deploy, bulk regrade, or run real candidate interviews in this implementation.

---

### Task 1: Backend Rubric Model And Validation

**Files:**
- Modify: `backend/src/grading/rubric.ts`
- Test: `backend/test/grading-rubric.test.ts`

- [ ] **Step 1: Write failing rubric library tests**

Add these tests to `backend/test/grading-rubric.test.ts` after the existing complete-rubric validation test:

```ts
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
```

- [ ] **Step 2: Run failing rubric tests**

Run:

```bash
cd backend && pnpm test -- grading-rubric.test.ts
```

Expected: FAIL because `dimensionKeys`, `sub_dimensions`, Communication, and Passion for Sales are not implemented yet.

- [ ] **Step 3: Implement rubric types, library, draft building, and validation**

In `backend/src/grading/rubric.ts`, update the dimension interfaces:

```ts
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
```

Update `RoleRubric.bare_minimum_rule`:

```ts
  readonly bare_minimum_rule:
    | "at_least_one_4_and_problem_solving_ge_3"
    | "at_least_one_4_and_average_ge_3";
```

Update `buildDraftRubric` input and use selected keys:

```ts
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
```

Add these helpers near the clone helpers:

```ts
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

function containsAccentLanguage(dimension: RoleRubricDimension): boolean {
  if (dimension.key !== "communication") {
    return false;
  }
  const values = [
    dimension.meaning,
    ...Object.values(dimension.anchors),
    ...(dimension.sub_dimensions ?? []).flatMap((subDimension) => Object.values(subDimension.anchors)),
  ];
  return values.some((text) => /\baccent\b/i.test(text));
}
```

Update validation after the dimensions array check:

```ts
if (value.dimensions.length < 3 || value.dimensions.length > 6) {
  return { ok: false, error: "Rubric must define between 3 and 6 dimensions." };
}
const seenDimensionKeys = new Set<string>();
for (const dimension of value.dimensions) {
  if (!isRecord(dimension) || !hasStringFields(dimension, ["key", "name", "meaning"])) {
    return { ok: false, error: "Each rubric dimension must define key, name, and meaning." };
  }
  if (!isWeaveDimensionKey(dimension.key)) {
    return { ok: false, error: "Rubric dimension key is not in the Weave dimension library." };
  }
  if (seenDimensionKeys.has(dimension.key)) {
    return { ok: false, error: "Rubric dimension keys must be unique." };
  }
  seenDimensionKeys.add(dimension.key);
  if (!hasAnchorSet(dimension.anchors)) {
    return { ok: false, error: "Each rubric dimension must define anchors 1, 2, 3, and 4." };
  }
  if (Array.isArray(dimension.sub_dimensions)) {
    for (const subDimension of dimension.sub_dimensions) {
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
  if (containsAccentLanguage(dimension as RoleRubricDimension)) {
    return { ok: false, error: "Communication rubric must not score accent." };
  }
}
```

In the question validation loop, add category-scope validation:

```ts
    if (question.rubric_categories.some((category) => !seenDimensionKeys.has(category))) {
      return { ok: false, error: "Rubric questions must reference selected dimensions." };
    }
```

Update the bare minimum validation to accept both rules:

```ts
if (
  value.bare_minimum_rule !== "at_least_one_4_and_problem_solving_ge_3" &&
  value.bare_minimum_rule !== "at_least_one_4_and_average_ge_3"
) {
  return { ok: false, error: "Rubric bare minimum rule is invalid." };
}
```

Update `cloneDimensions` to copy sub-dimensions:

```ts
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
```

Replace `PILOT_DIMENSIONS` and `PILOT_QUESTIONS` with record libraries:

```ts
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
```

Add matching `WEAVE_QUESTION_LIBRARY` entries for each key:

```ts
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
```

- [ ] **Step 4: Run rubric tests**

Run:

```bash
cd backend && pnpm test -- grading-rubric.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit backend rubric model**

```bash
git add backend/src/grading/rubric.ts backend/test/grading-rubric.test.ts
git commit -m "feat(grading): add role rubric dimension library"
```

---

### Task 2: Backend Draft Route Persists Submitted Rubrics

**Files:**
- Modify: `backend/src/grading/routes.ts`
- Test: `backend/test/grading-routes.test.ts`

- [ ] **Step 1: Write failing route test for submitted draft persistence**

Add this test to `backend/test/grading-routes.test.ts` after `"creates a draft rubric for a grading profile"`:

```ts
it("stores a submitted rubric as the current draft version", async () => {
  const rubric = buildDraftRubric({
    organizationId: "org_1",
    ashbyJobId: "job_1",
    jobName: "Account Executive",
    historicalSessionCount: 3,
    matchedApplicationCount: 2,
    dimensionKeys: ["communication", "passion_for_sales", "agency"],
  });
  const editedRubric = {
    ...rubric,
    dimensions: rubric.dimensions.map((dimension) =>
      dimension.key === "communication"
        ? {
            ...dimension,
            anchors: { ...dimension.anchors, 2: "Clearly articulates themselves." },
          }
        : dimension,
    ),
  };
  const app = buildServer(FAKE_LK);
  try {
    const res = await app.inject({
      method: "POST",
      url: "/grading/profiles/profile_1/draft",
      headers: { "content-type": "application/json" },
      payload: {
        organizationId: "org_1",
        actorEmail: "reviewer@example.com",
        jobName: "Account Executive",
        rubric: editedRubric,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      rubricVersionId: expect.any(String),
      rubric: editedRubric,
    });
    const insertCall = queryCalls.find((call) => call.sql.includes("INSERT INTO role_rubric_versions"));
    expect(insertCall?.params[7]).toBe(JSON.stringify(editedRubric));
    expect(insertCall?.params[8]).toBe(JSON.stringify({
      source: "dashboard_rubric_editor",
      jobName: "Account Executive",
    }));
  } finally {
    await app.close();
  }
});

it("rejects submitted draft rubrics that do not match the locked profile role", async () => {
  const rubric = buildDraftRubric({
    organizationId: "org_1",
    ashbyJobId: "job_other",
    jobName: "Other Role",
    historicalSessionCount: 1,
    matchedApplicationCount: 1,
    dimensionKeys: ["communication", "passion_for_sales", "agency"],
  });
  const app = buildServer(FAKE_LK);
  try {
    const res = await app.inject({
      method: "POST",
      url: "/grading/profiles/profile_1/draft",
      headers: { "content-type": "application/json" },
      payload: {
        organizationId: "org_1",
        actorEmail: "reviewer@example.com",
        jobName: "Other Role",
        rubric,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "rubric role must match the grading profile" });
    expect(sqlCalls).toContain("ROLLBACK");
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run failing route tests**

Run:

```bash
cd backend && pnpm test -- grading-routes.test.ts
```

Expected: FAIL because the draft route ignores submitted `rubric`.

- [ ] **Step 3: Implement submitted-rubric handling**

In `backend/src/grading/routes.ts`, add this helper near `recommendationPolicyFromRubric`:

```ts
function roleRubricMatchesProfile(rubric: unknown, input: {
  readonly organizationId: string;
  readonly ashbyJobId: string;
}): boolean {
  const rubricObject = objectValue(rubric);
  const role = objectValue(rubricObject.role);
  return stringValue(role.organization_id) === input.organizationId &&
    stringValue(role.ashby_job_id) === input.ashbyJobId;
}
```

Inside the draft route, after the profile row is loaded and `ashbyJobId` is known, replace the `const rubric = buildDraftRubric(...)` block with:

```ts
      const submittedRubric = body.rubric;
      const rubric = submittedRubric === undefined
        ? buildDraftRubric({
            organizationId,
            ashbyJobId,
            jobName,
            historicalSessionCount: historicalSessionCount.value,
            matchedApplicationCount: matchedApplicationCount.value,
          })
        : submittedRubric;
      const validation = validateRoleRubric(rubric);
      if (!validation.ok) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: validation.error });
      }
      if (!roleRubricMatchesProfile(rubric, { organizationId, ashbyJobId })) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "rubric role must match the grading profile" });
      }
```

Replace `generationInputs` in the insert call with:

```ts
        generationInputs: submittedRubric === undefined
          ? {
              source: "weave_seeded_pilot",
              historicalSessionCount: historicalSessionCount.value,
              matchedApplicationCount: matchedApplicationCount.value,
            }
          : {
              source: "dashboard_rubric_editor",
              jobName,
            },
```

- [ ] **Step 4: Run route tests**

Run:

```bash
cd backend && pnpm test -- grading-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit draft persistence**

```bash
git add backend/src/grading/routes.ts backend/test/grading-routes.test.ts
git commit -m "feat(grading): persist edited role rubric drafts"
```

---

### Task 3: Backend Prompt And Recommendation Behavior

**Files:**
- Modify: `backend/src/grading/scoring.ts`
- Modify: `backend/src/grading/evaluation/calibration.ts`
- Modify: `backend/src/grading/recommendation.ts`
- Test: `backend/test/grading-scoring.test.ts`
- Test: `backend/test/grading-recommendation.test.ts`
- Test: `backend/test/grading-session-recommendations.test.ts`

- [ ] **Step 1: Write failing prompt test for selected role dimensions**

Add this test to `backend/test/grading-scoring.test.ts` after the existing prompt-building test:

```ts
it("instructs the model to score only the selected role rubric dimensions", () => {
  const prompt = buildScoringPrompt({
    rubric: {
      script_version: "job_sales-v1",
      dimensions: [
        {
          key: "communication",
          name: "Communication",
          meaning: "Engages in conversation.",
          anchors: { 1: "Low", 2: "Clear", 3: "Enjoyable", 4: "Clarifying" },
        },
        {
          key: "passion_for_sales",
          name: "Passion for Sales",
          meaning: "Figures out a way to be at the top of the leaderboard.",
          anchors: { 1: "Weak", 2: "Some", 3: "Strong", 4: "Exceptional" },
          sub_dimensions: [
            {
              key: "reason_for_getting_into_sales",
              name: "Reason for Getting Into Sales",
              anchors: { 1: "Fell into it.", 2: "Family in sales.", 3: "Interested.", 4: "Money-motivated." },
            },
          ],
        },
        {
          key: "agency",
          name: "Agency",
          meaning: "Stops at nothing.",
          anchors: { 1: "Low", 2: "Expected", 3: "Extra", 4: "Rules hack" },
        },
      ],
    },
    transcriptTurns,
  });

  expect(prompt).toContain("ROLE_RUBRIC_SCORING_INSTRUCTIONS:");
  expect(prompt).toContain("Score exactly these rubric dimension keys: communication, passion_for_sales, agency.");
  expect(prompt).toContain("Do not output category scores for dimensions that are not listed in RUBRIC_JSON.dimensions.");
  expect(prompt).toContain("For passion_for_sales, use sub_dimensions as internal evidence and return one final category score named passion_for_sales.");
});

it("filters legacy calibration anchors and examples for custom role rubrics", () => {
  const calibrationExamples = [
    {
      id: "legacy_example",
      summary: "Legacy engineering calibration.",
      scores: {
        problem_solving: 3,
        agency: 2,
        competitiveness: 2,
        curious: 2,
      },
      missingQuestions: {},
      scriptedRisk: "low",
      comment: "Legacy example.",
      totalScore: 9,
    },
  ];
  const prompt = buildScoringPrompt({
    rubric: {
      script_version: "job_sales-v1",
      dimensions: [
        {
          key: "communication",
          name: "Communication",
          meaning: "Engages in conversation.",
          anchors: { 1: "Low", 2: "Clear", 3: "Enjoyable", 4: "Clarifying" },
        },
        {
          key: "passion_for_sales",
          name: "Passion for Sales",
          meaning: "Leaderboard drive.",
          anchors: { 1: "Weak", 2: "Some", 3: "Strong", 4: "Exceptional" },
        },
        {
          key: "agency",
          name: "Agency",
          meaning: "Stops at nothing.",
          anchors: { 1: "Low", 2: "Expected", 3: "Extra", 4: "Rules hack" },
        },
      ],
    },
    transcriptTurns,
    dimensionScoreAnchors: defaultDimensionScoreAnchors(),
    calibrationExamples,
  });

  expect(prompt).toContain('"category": "communication"');
  expect(prompt).toContain("DIMENSION_SCORE_ANCHORS_JSON:");
  expect(prompt).toContain('"agency"');
  expect(prompt).not.toContain('"problem_solving": {');
  expect(prompt).not.toContain('"competitiveness": {');
  expect(prompt).not.toContain('"curious": {');
  expect(prompt).not.toContain("CALIBRATION_EXAMPLES_JSON:");
  expect(prompt).not.toContain("legacy_example");
});
```

- [ ] **Step 2: Write failing recommendation policy test**

Add this test to `backend/test/grading-recommendation.test.ts`:

```ts
it("advances non-problem-solving role rubrics using an average-score rule", () => {
  expect(
    recommendInterview({
      categoryScores: [
        { category: "communication", score: 3, confidence: 0.9, evidenceQuotes: ["quote"] },
        { category: "passion_for_sales", score: 4, confidence: 0.86, evidenceQuotes: ["quote"] },
        { category: "agency", score: 3, confidence: 0.84, evidenceQuotes: ["quote"] },
      ],
      bareMinimumRule: "at_least_one_4_and_average_ge_3",
      minimumConfidence: 0.75,
      severeWarnings: [],
    }),
  ).toEqual({
    recommendation: "advance",
    confidence: 0.87,
    warnings: [],
  });
});
```

- [ ] **Step 3: Run failing scoring and recommendation tests**

Run:

```bash
cd backend && pnpm test -- grading-scoring.test.ts grading-recommendation.test.ts
```

Expected: FAIL because the prompt instructions and new recommendation rule are missing.

- [ ] **Step 4: Implement dynamic prompt instructions and dynamic output example**

In `backend/src/grading/scoring.ts`, add:

```ts
function selectedRubricDimensionKeys(rubric: unknown): readonly string[] {
  if (!rubric || typeof rubric !== "object" || Array.isArray(rubric)) {
    return [];
  }
  const dimensions = (rubric as { readonly dimensions?: unknown }).dimensions;
  if (!Array.isArray(dimensions)) {
    return [];
  }
  return dimensions.flatMap((dimension) => {
    if (!dimension || typeof dimension !== "object" || Array.isArray(dimension)) {
      return [];
    }
    const key = (dimension as { readonly key?: unknown }).key;
    return typeof key === "string" && key.trim() ? [key.trim()] : [];
  });
}
```

At the top of `buildScoringPrompt`, before `promptSections`, add:

```ts
  const selectedDimensionKeys = selectedRubricDimensionKeys(input.rubric);
  const exampleCategory = selectedDimensionKeys[0] ?? "problem_solving";
```

In `OUTPUT_JSON_SHAPE`, replace hardcoded `"problem_solving"` category examples with `exampleCategory`:

```ts
            category: exampleCategory,
```

```ts
          dimensions: [{ category: exampleCategory, score: 4 }],
```

Before the optional grading guide section, add:

```ts
  if (selectedDimensionKeys.length > 0) {
    promptSections.push(
      "",
      "ROLE_RUBRIC_SCORING_INSTRUCTIONS:",
      `Score exactly these rubric dimension keys: ${selectedDimensionKeys.join(", ")}.`,
      "Do not output category scores for dimensions that are not listed in RUBRIC_JSON.dimensions.",
      "final_scores.dimensions must contain the same rubric dimension keys and no extra keys.",
      "For passion_for_sales, use sub_dimensions as internal evidence and return one final category score named passion_for_sales.",
    );
  }
```

- [ ] **Step 5: Filter legacy calibration payloads**

In `backend/src/grading/scoring.ts`, add:

```ts
const legacyCalibrationDimensionKeys = new Set([
  "problem_solving",
  "agency",
  "competitiveness",
  "curious",
]);

function selectedAnchorPayload(
  anchors: DimensionScoreAnchors,
  selectedDimensionKeys: readonly string[],
): Record<string, unknown> {
  if (selectedDimensionKeys.length === 0) {
    return anchors;
  }
  return Object.fromEntries(
    selectedDimensionKeys.flatMap((key) =>
      Object.prototype.hasOwnProperty.call(anchors, key)
        ? [[key, anchors[key as keyof DimensionScoreAnchors]]]
        : [],
    ),
  );
}

function shouldIncludeCalibrationExamples(selectedDimensionKeys: readonly string[]): boolean {
  if (selectedDimensionKeys.length === 0) {
    return true;
  }
  return selectedDimensionKeys.length === legacyCalibrationDimensionKeys.size &&
    selectedDimensionKeys.every((key) => legacyCalibrationDimensionKeys.has(key));
}
```

Replace the dimension anchor block with:

```ts
  if (input.dimensionScoreAnchors) {
    const anchors = selectedAnchorPayload(input.dimensionScoreAnchors, selectedDimensionKeys);
    if (hasDimensionScoreAnchors(anchors)) {
      promptSections.push(
        "",
        "DIMENSION_SCORE_ANCHOR_INSTRUCTIONS:",
        "Use DIMENSION_SCORE_ANCHORS_JSON as calibration examples for the score scale.",
        "Each anchor is an example of an actual answer where the relevant question was asked.",
        "Do not treat missing-question neutral defaults as score anchors.",
        "Do not copy anchor rationales; use them only to calibrate the score level.",
        "If a candidate's answer falls between anchors, use 0.5 increments.",
        "If the question was genuinely not asked, apply the missing-question rule from GRADING_GUIDE instead.",
        "",
        "DIMENSION_SCORE_ANCHORS_JSON:",
        JSON.stringify(anchors, null, 2),
      );
    }
  }
```

Replace the calibration examples condition with:

```ts
  if (
    input.calibrationExamples &&
    input.calibrationExamples.length > 0 &&
    shouldIncludeCalibrationExamples(selectedDimensionKeys)
  ) {
    promptSections.push("", "CALIBRATION_EXAMPLES_JSON:", JSON.stringify(input.calibrationExamples, null, 2));
  }
```

Update `hasDimensionScoreAnchors` to accept the filtered record:

```ts
function hasDimensionScoreAnchors(anchors: Record<string, unknown>): boolean {
  return Object.values(anchors).some((scoreAnchors) =>
    scoreAnchors &&
    typeof scoreAnchors === "object" &&
    !Array.isArray(scoreAnchors) &&
    Object.values(scoreAnchors).some((examples) => Array.isArray(examples) && examples.length > 0),
  );
}
```

- [ ] **Step 6: Update grading guide language**

In `backend/src/grading/evaluation/calibration.ts`, replace:

```ts
"Grade the candidate on exactly four dimensions: problem_solving, agency, competitiveness, and curious.",
```

with:

```ts
"Grade the candidate on exactly the dimensions provided in RUBRIC_JSON.dimensions.",
```

Replace:

```ts
"Use only job-related answer content; do not infer ability or score from protected characteristics or proxies. Job-related means relevant to the four hiring dimensions, not limited to workplace examples; hobby, sport, gaming, craft, and personal-domain answers are rubric-relevant when they answer the scripted question.",
```

with:

```ts
"Use only job-related answer content; do not infer ability or score from protected characteristics or proxies. Job-related means relevant to the active role rubric dimensions, not limited to workplace examples; hobby, sport, gaming, craft, and personal-domain answers are rubric-relevant when they answer the scripted question.",
```

- [ ] **Step 7: Implement general role-rubric recommendation rule**

In `backend/src/grading/recommendation.ts`, update the type:

```ts
export interface RecommendationRuleInput {
  readonly categoryScores: readonly RecommendationScore[];
  readonly bareMinimumRule: "at_least_one_4_and_problem_solving_ge_3" | "at_least_one_4_and_average_ge_3" | string;
  readonly minimumConfidence: number;
  readonly severeWarnings: readonly string[];
}
```

Update `meetsBareMinimum`:

```ts
function meetsBareMinimum(input: RecommendationRuleInput): boolean {
  if (input.bareMinimumRule === "at_least_one_4_and_average_ge_3") {
    const averageScore = roundedAverage(input.categoryScores.map((score) => score.score));
    const hasFour = input.categoryScores.some((score) => score.score >= 4);
    return hasFour && averageScore >= 3;
  }

  if (input.bareMinimumRule !== "at_least_one_4_and_problem_solving_ge_3") {
    return false;
  }

  const byCategory = new Map(input.categoryScores.map((score) => [score.category, score]));
  const problemSolving = byCategory.get("problem_solving")?.score ?? 0;
  const hasFour = input.categoryScores.some((score) => score.score >= 4);
  return hasFour && problemSolving >= 3;
}
```

- [ ] **Step 8: Add session recommendation test for dynamic rubric pass-through**

In `backend/test/grading-session-recommendations.test.ts`, add this assertion to `"loads a session transcript and active rubric before scoring"` after the existing `scoreTranscriptMock` assertion:

```ts
expect(scoreTranscriptMock.mock.calls[0]?.[0]).toEqual(
  expect.objectContaining({
    rubric: routeState.rubricRows[0].rubric,
  }),
);
```

Add a new test:

```ts
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
```

- [ ] **Step 9: Run scoring, recommendation, and session tests**

Run:

```bash
cd backend && pnpm test -- grading-scoring.test.ts grading-recommendation.test.ts grading-session-recommendations.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit prompt and recommendation behavior**

```bash
git add backend/src/grading/scoring.ts backend/src/grading/evaluation/calibration.ts backend/src/grading/recommendation.ts backend/test/grading-scoring.test.ts backend/test/grading-recommendation.test.ts backend/test/grading-session-recommendations.test.ts
git commit -m "feat(grading): score against active role rubric dimensions"
```

---

### Task 4: Platform Server Data And API Routes

**Files:**
- Modify: `platform/app/dashboard/backend-data.ts`
- Create: `platform/app/api/grading/company-state/route.ts`
- Create: `platform/app/api/grading/profiles/[profileId]/draft/route.ts`
- Create: `platform/app/api/grading/profiles/[profileId]/approve/route.ts`
- Test: `platform/tests/org-access-source.test.mjs`
- Test: `platform/tests/backend-api-helper.test.mjs`

- [ ] **Step 1: Write failing platform source tests**

In `platform/tests/org-access-source.test.mjs`, add the new route files to `dashboardActionRoutes`:

```js
"../app/api/grading/company-state/route.ts",
"../app/api/grading/profiles/[profileId]/draft/route.ts",
"../app/api/grading/profiles/[profileId]/approve/route.ts",
```

In `platform/tests/backend-api-helper.test.mjs`, add route files to `routeFiles`:

```js
"app/api/grading/company-state/route.ts",
"app/api/grading/profiles/[profileId]/draft/route.ts",
"app/api/grading/profiles/[profileId]/approve/route.ts",
```

Add this test to `platform/tests/backend-api-helper.test.mjs`:

```js
test("dashboard grading data reads use timeout-bounded backend fetches", () => {
  assert.match(dashboardDataSource, /getGradingCompanyState/);
  assert.match(dashboardDataSource, /\/grading\/company-state/);
  assert.match(dashboardDataSource, /backendFetch/);
});
```

- [ ] **Step 2: Run failing platform tests**

Run:

```bash
cd platform && pnpm test -- tests/org-access-source.test.mjs tests/backend-api-helper.test.mjs
```

Expected: FAIL because grading API routes and `getGradingCompanyState` do not exist.

- [ ] **Step 3: Add platform grading types and company-state read**

Append to `platform/app/dashboard/backend-data.ts`:

```ts
export interface RoleRubricSubDimension {
  readonly key: string;
  readonly name: string;
  readonly anchors: Record<string, string>;
}

export interface RoleRubricDimension {
  readonly key: string;
  readonly name: string;
  readonly meaning: string;
  readonly anchors: Record<string, string>;
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
  readonly bare_minimum_rule: string;
  readonly recommendation_thresholds: {
    readonly minimum_confidence: number;
  };
  readonly disallowed_signals: readonly string[];
  readonly generation_context: {
    readonly historical_session_count: number;
    readonly matched_application_count: number;
  };
}

export interface RoleGradingProfile {
  readonly profile_id: string;
  readonly organization_id: string;
  readonly ashby_integration_id: string;
  readonly ashby_job_id: string;
  readonly status: string;
  readonly active_rubric_version_id: string | null;
  readonly draft_rubric_version_id: string | null;
  readonly active_rubric: RoleRubric | null;
  readonly draft_rubric: RoleRubric | null;
}

export async function getGradingCompanyState(input: {
  readonly orgId: string;
}): Promise<readonly RoleGradingProfile[]> {
  const response = await backendFetch(`${backendBaseUrl()}/grading/company-state`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify({ organizationId: input.orgId }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`backend returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    readonly profiles?: readonly RoleGradingProfile[];
  };
  return payload.profiles ?? [];
}
```

- [ ] **Step 4: Add company-state API route**

Create `platform/app/api/grading/company-state/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST() {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl()}/grading/company-state`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({ organizationId: access.organizationId }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
```

- [ ] **Step 5: Add draft API route**

Create `platform/app/api/grading/profiles/[profileId]/draft/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly profileId: string;
  }>;
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const { profileId } = await context.params;
  const body = objectBody(await request.json().catch(() => ({})));
  const actorEmail = stringValue(access.user.email);
  if (!actorEmail) {
    return NextResponse.json({ error: "Signed-in user email is required." }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl()}/grading/profiles/${encodeURIComponent(profileId)}/draft`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        organizationId: access.organizationId,
        actorEmail,
        jobName: stringValue(body.jobName),
        rubric: body.rubric,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
```

- [ ] **Step 6: Add approve API route**

Create `platform/app/api/grading/profiles/[profileId]/approve/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly profileId: string;
  }>;
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const { profileId } = await context.params;
  const body = objectBody(await request.json().catch(() => ({})));
  const rubricVersionId = stringValue(body.rubricVersionId);
  const actorEmail = stringValue(access.user.email);
  if (!rubricVersionId || !actorEmail) {
    return NextResponse.json({ error: "rubricVersionId and actorEmail are required." }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl()}/grading/profiles/${encodeURIComponent(profileId)}/approve`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        organizationId: access.organizationId,
        actorEmail,
        rubricVersionId,
        rubric: body.rubric,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
```

- [ ] **Step 7: Run platform route tests**

Run:

```bash
cd platform && pnpm test -- tests/org-access-source.test.mjs tests/backend-api-helper.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit platform API routes**

```bash
git add platform/app/dashboard/backend-data.ts platform/app/api/grading platform/tests/org-access-source.test.mjs platform/tests/backend-api-helper.test.mjs
git commit -m "feat(platform): add grading rubric dashboard APIs"
```

---

### Task 5: Platform Rubric Editor Model

**Files:**
- Create: `platform/app/dashboard/roles/[roleId]/role-rubric-model.ts`
- Test: `platform/tests/role-rubric-source.test.mjs`

- [ ] **Step 1: Write failing source test for rubric model**

Create `platform/tests/role-rubric-source.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modelSource = await readFile(
  new URL("../app/dashboard/roles/[roleId]/role-rubric-model.ts", import.meta.url),
  "utf8",
).catch(() => "");
const editorSource = await readFile(
  new URL("../app/dashboard/roles/[roleId]/RoleRubricEditor.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const roleTabsSource = await readFile(
  new URL("../app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx", import.meta.url),
  "utf8",
);
const rolePageSource = await readFile(new URL("../app/dashboard/roles/[roleId]/page.tsx", import.meta.url), "utf8");

test("role rubric model contains the six Weave dimensions without accent scoring", () => {
  assert.match(modelSource, /weaveDimensionLibrary/);
  for (const key of [
    "problem_solving",
    "agency",
    "competitiveness",
    "curious",
    "communication",
    "passion_for_sales",
  ]) {
    assert.match(modelSource, new RegExp(key));
  }
  assert.match(modelSource, /Choppy, incomprehensible, or hard to follow/);
  assert.match(modelSource, /reason_for_getting_into_sales/);
  assert.match(modelSource, /professional_sales_background/);
  assert.match(modelSource, /performance_as_salesperson/);
  assert.doesNotMatch(modelSource, /heavy accent/i);
});

test("role rubric editor saves drafts and approves stored draft versions", () => {
  assert.match(editorSource, /"use client"/);
  assert.match(editorSource, /\/api\/grading\/profiles\/\$\{encodeURIComponent\(profile\.profile_id\)\}\/draft/);
  assert.match(editorSource, /\/api\/grading\/profiles\/\$\{encodeURIComponent\(profile\.profile_id\)\}\/approve/);
  assert.match(editorSource, /selectedDimensionKeys/);
  assert.match(editorSource, /Passion for Sales/);
  assert.match(editorSource, /sub_dimensions/);
  assert.match(editorSource, /role="status"/);
  assert.match(editorSource, /aria-live="polite"/);
});

test("role workspace loads and renders the persisted grading profile for the selected role", () => {
  assert.match(rolePageSource, /getGradingCompanyState/);
  assert.match(rolePageSource, /gradingProfiles/);
  assert.match(rolePageSource, /selectedGradingProfile/);
  assert.match(roleTabsSource, /RoleRubricEditor/);
  assert.match(roleTabsSource, /gradingProfile/);
  assert.doesNotMatch(roleTabsSource, /rubric is not configured in Puddle yet/);
});
```

- [ ] **Step 2: Run failing role-rubric source test**

Run:

```bash
cd platform && pnpm test -- tests/role-rubric-source.test.mjs
```

Expected: FAIL because the model and editor do not exist.

- [ ] **Step 3: Create the rubric model file**

Create `platform/app/dashboard/roles/[roleId]/role-rubric-model.ts`:

```ts
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
      "1": "Downvoted.",
      "2": "Found a solution alongside others.",
      "3": "Accepted answer on Stack Overflow.",
      "4": "Front page on Hacker News.",
    },
  },
  agency: {
    key: "agency",
    name: "Agency",
    meaning: "Stops at nothing to solve a problem.",
    anchors: {
      "1": "Does not meet expectations.",
      "2": "Does everything expected or asked.",
      "3": "Puts in more effort than expected.",
      "4": "Hacked or broke rules to solve the problem.",
    },
  },
  competitiveness: {
    key: "competitiveness",
    name: "Competitiveness",
    meaning: "Gets consumed by a desire to win.",
    anchors: {
      "1": "Absence of competitiveness.",
      "2": "Does not like to lose.",
      "3": "Emotionally affected by losing.",
      "4": "Competitive to a detrimental degree in some facet of life.",
    },
  },
  curious: {
    key: "curious",
    name: "Curiosity",
    meaning: "Needs to know the why behind everything, and acts on it.",
    anchors: {
      "1": "Absence of curiosity.",
      "2": "Signs of curiosity but no action.",
      "3": "Very curious about something and takes action.",
      "4": "Obsessively curious, becomes an expert.",
    },
  },
  communication: {
    key: "communication",
    name: "Communication",
    meaning: "Engages in conversation by listening, understanding, and articulating themselves.",
    anchors: {
      "1": "Choppy, incomprehensible, or hard to follow.",
      "2": "Articulates themselves well.",
      "3": "Enjoyable to talk to and articulates themselves well.",
      "4": "Asks clarifying questions, enjoyable to talk to, and articulates themselves clearly.",
    },
  },
  passion_for_sales: {
    key: "passion_for_sales",
    name: "Passion for Sales",
    meaning: "Figures out a way to be at the top of the leaderboard.",
    anchors: {
      "1": "Weak sales motivation, weak sales preparation, and weak performance evidence.",
      "2": "Some sales exposure or motivation, with limited training or performance evidence.",
      "3": "Strong sales motivation, training, or top-performer evidence across multiple sub-dimensions.",
      "4": "Exceptional sales drive with high-end evidence across reason, background, and performance.",
    },
    sub_dimensions: [
      {
        key: "reason_for_getting_into_sales",
        name: "Reason for Getting Into Sales",
        anchors: {
          "1": "Fell into it.",
          "2": "Family in sales.",
          "3": "Founder-oriented or personally interested.",
          "4": "Money-motivated.",
        },
      },
      {
        key: "professional_sales_background",
        name: "Professional Sales Background",
        anchors: {
          "1": "No training.",
          "2": "Self-taught.",
          "3": "Formal training.",
          "4": "Self-taught plus formal training.",
        },
      },
      {
        key: "performance_as_salesperson",
        name: "Performance as a Salesperson",
        anchors: {
          "1": "No promotions or job hopping.",
          "2": "Some promotions or promotions due to tenure.",
          "3": "Top performer and bored.",
          "4": "Cannot be promoted.",
        },
      },
    ],
  },
};
```

Append helpers in the same file:

```ts
const questionLibrary: Record<WeaveDimensionKey, RoleRubricQuestion> = {
  problem_solving: {
    question_id: "problem_solving",
    verbatim_text: "Can you tell me about a technically complex problem you solved with a clever or hacky solution?",
    rubric_categories: ["problem_solving"],
    target_evidence: ["the problem and why it was hard", "the solution and why it was clever or elegant", "the impact and level of recognition"],
  },
  agency: {
    question_id: "agency",
    verbatim_text: "Can you tell me about the time you hacked a non-computer system to your advantage?",
    rubric_categories: ["agency"],
    target_evidence: ["the system and rules", "what the candidate did", "the outcome and cost"],
  },
  competitiveness: {
    question_id: "competitiveness",
    verbatim_text: "Can you tell me about an area of your life where your competitiveness became so intense that it cost you something?",
    rubric_categories: ["competitiveness"],
    target_evidence: ["what winning meant", "how intense it became", "the concrete cost"],
  },
  curious: {
    question_id: "curious",
    verbatim_text: "Can you tell me about a niche or obscure topic that no one knows about but you are an expert in?",
    rubric_categories: ["curious"],
    target_evidence: ["the topic", "how they became an expert", "evidence of top-percentile depth"],
  },
  communication: {
    question_id: "communication",
    verbatim_text: "How do you usually make sure a conversation is useful for both sides?",
    rubric_categories: ["communication"],
    target_evidence: ["answers directly", "asks clarifying questions", "is concise and easy to follow"],
  },
  passion_for_sales: {
    question_id: "passion_for_sales",
    verbatim_text: "Why did you get into sales, how did you learn how to sell, and where has that led you today?",
    rubric_categories: ["passion_for_sales"],
    target_evidence: ["reason for sales", "sales training background", "sales performance"],
  },
};

function cloneDimension(dimension: RoleRubricDimension): RoleRubricDimension {
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

export function buildRoleRubric(input: {
  readonly organizationId: string;
  readonly ashbyJobId: string;
  readonly title: string;
  readonly dimensions: readonly RoleRubricDimension[];
  readonly historicalSessionCount?: number;
  readonly matchedApplicationCount?: number;
}): RoleRubric {
  const dimensionKeys = input.dimensions.map((dimension) => dimension.key);
  return {
    script_version: `${input.ashbyJobId}-v1`,
    role: {
      organization_id: input.organizationId,
      ashby_job_id: input.ashbyJobId,
      title: input.title,
    },
    dimensions: input.dimensions.map(cloneDimension),
    questions: dimensionKeys.flatMap((key) => {
      return weaveDimensionKeys.includes(key as WeaveDimensionKey)
        ? [questionLibrary[key as WeaveDimensionKey]]
        : [];
    }),
    bare_minimum_rule: dimensionKeys.includes("problem_solving")
      ? "at_least_one_4_and_problem_solving_ge_3"
      : "at_least_one_4_and_average_ge_3",
    recommendation_thresholds: { minimum_confidence: 0.75 },
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
    return rubric.dimensions.map(cloneDimension);
  }
  return defaultSelectedDimensionKeys.map((key) => cloneDimension(weaveDimensionLibrary[key]));
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
```

- [ ] **Step 4: Run model source test**

Run:

```bash
cd platform && pnpm test -- tests/role-rubric-source.test.mjs
```

Expected: still FAIL because the editor and wiring do not exist yet.

- [ ] **Step 5: Commit model after editor task**

Do not commit yet. Commit model and editor together in Task 7.

---

### Task 6: Role Page Loads Persisted Grading State

**Files:**
- Modify: `platform/app/dashboard/roles/[roleId]/page.tsx`
- Modify: `platform/app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx`
- Test: `platform/tests/role-rubric-source.test.mjs`
- Test: `platform/tests/dashboard-foundation-source.test.mjs`

- [ ] **Step 1: Update role page server data**

In `platform/app/dashboard/roles/[roleId]/page.tsx`, update imports:

```ts
import { getGradingCompanyState } from "../../backend-data";
```

After `const ashbyJobs = ashbyJobReferences(pipeline.roles);`, add:

```ts
  const gradingProfiles = await getGradingCompanyState({ orgId: organizationId });
```

After `selectedRole` is found, add:

```ts
  const selectedGradingProfile =
    gradingProfiles.find((profile) => profile.ashby_job_id === selectedRole.jobId) ?? null;
```

Update the tabs render:

```tsx
<RoleWorkspaceTabs
  selectedRole={selectedRole}
  ashbyJobs={ashbyJobs}
  gradingProfile={selectedGradingProfile}
  organizationId={organizationId}
/>
```

- [ ] **Step 2: Update RoleWorkspaceTabs props**

In `platform/app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx`, add imports:

```ts
import type { RoleGradingProfile } from "../../backend-data";
import { RoleRubricEditor } from "./RoleRubricEditor";
```

Update props:

```ts
export function RoleWorkspaceTabs({
  selectedRole,
  ashbyJobs,
  gradingProfile,
  organizationId,
}: {
  readonly selectedRole: AshbyJobReference;
  readonly ashbyJobs: readonly AshbyJobReference[];
  readonly gradingProfile: RoleGradingProfile | null;
  readonly organizationId: string;
}) {
```

Update Rubric tab render:

```tsx
{activeTab === "Rubric" ? (
  <RoleRubricEditor
    selectedRole={selectedRole}
    organizationId={organizationId}
    profile={gradingProfile}
  />
) : null}
```

Delete the local `RubricTab` function.

- [ ] **Step 3: Update dashboard foundation source test**

In `platform/tests/dashboard-foundation-source.test.mjs`, add assertions to the role workspace tests:

```js
assert.match(roleDetailSource, /getGradingCompanyState/);
assert.match(roleDetailSource, /selectedGradingProfile/);
assert.match(roleTabsSource, /RoleRubricEditor/);
assert.match(roleTabsSource, /gradingProfile/);
```

- [ ] **Step 4: Run source tests**

Run:

```bash
cd platform && pnpm test -- tests/role-rubric-source.test.mjs tests/dashboard-foundation-source.test.mjs
```

Expected: FAIL only because `RoleRubricEditor.tsx` does not exist.

---

### Task 7: Role Rubric Editor UI

**Files:**
- Create: `platform/app/dashboard/roles/[roleId]/RoleRubricEditor.tsx`
- Modify: `platform/app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx`
- Test: `platform/tests/role-rubric-source.test.mjs`

- [ ] **Step 1: Create editor component**

Create `platform/app/dashboard/roles/[roleId]/RoleRubricEditor.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { RoleGradingProfile, RoleRubric, RoleRubricDimension } from "../../backend-data";
import { cx, EmptyState, primaryButtonClass, secondaryButtonClass, StatusPill, TableScroller } from "../../dashboard-ui";
import type { AshbyJobReference } from "../ashby-role-labels";
import {
  buildRoleRubric,
  initialDimensions,
  selectedDimensionError,
  weaveDimensionKeys,
  weaveDimensionLibrary,
  type WeaveDimensionKey,
} from "./role-rubric-model";

type SaveState = "idle" | "saving" | "approving";

type Feedback = {
  readonly tone: "success" | "error";
  readonly text: string;
};

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

function activeRubric(profile: RoleGradingProfile | null): RoleRubric | null {
  return profile?.draft_rubric ?? profile?.active_rubric ?? null;
}

function activeRubricVersionId(profile: RoleGradingProfile | null): string | null {
  return profile?.draft_rubric_version_id ?? profile?.active_rubric_version_id ?? null;
}

function dimensionByKey(dimensions: readonly RoleRubricDimension[], key: string): RoleRubricDimension | null {
  return dimensions.find((dimension) => dimension.key === key) ?? null;
}

function cloneLibraryDimension(key: WeaveDimensionKey): RoleRubricDimension {
  const dimension = weaveDimensionLibrary[key];
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

function replaceDimension(
  dimensions: readonly RoleRubricDimension[],
  key: string,
  updater: (dimension: RoleRubricDimension) => RoleRubricDimension,
): RoleRubricDimension[] {
  return dimensions.map((dimension) => (dimension.key === key ? updater(dimension) : dimension));
}

export function RoleRubricEditor({
  selectedRole,
  organizationId,
  profile,
}: {
  readonly selectedRole: AshbyJobReference;
  readonly organizationId: string;
  readonly profile: RoleGradingProfile | null;
}) {
  const persistedRubric = activeRubric(profile);
  const persistedVersionId = activeRubricVersionId(profile);
  const [dimensions, setDimensions] = useState<RoleRubricDimension[]>(() => initialDimensions(persistedRubric));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [draftVersionId, setDraftVersionId] = useState<string | null>(profile?.draft_rubric_version_id ?? null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const selectedDimensionKeys = useMemo(() => dimensions.map((dimension) => dimension.key), [dimensions]);
  const selectionError = selectedDimensionError(dimensions);
  const currentRubric = buildRoleRubric({
    organizationId,
    ashbyJobId: selectedRole.jobId,
    title: selectedRole.name,
    dimensions,
    historicalSessionCount: persistedRubric?.generation_context.historical_session_count ?? 0,
    matchedApplicationCount: persistedRubric?.generation_context.matched_application_count ?? 0,
  });
  const disabled = saveState !== "idle";

  function toggleDimension(key: WeaveDimensionKey, enabled: boolean) {
    setFeedback(null);
    setDimensions((current) => {
      const exists = current.some((dimension) => dimension.key === key);
      if (enabled && !exists) {
        return [...current, cloneLibraryDimension(key)];
      }
      if (!enabled && exists) {
        return current.filter((dimension) => dimension.key !== key);
      }
      return current;
    });
  }

  function updateAnchor(key: string, score: string, value: string) {
    setFeedback(null);
    setDimensions((current) =>
      replaceDimension(current, key, (dimension) => ({
        ...dimension,
        anchors: { ...dimension.anchors, [score]: value },
      })),
    );
  }

  function updateSubAnchor(dimensionKey: string, subKey: string, score: string, value: string) {
    setFeedback(null);
    setDimensions((current) =>
      replaceDimension(current, dimensionKey, (dimension) => ({
        ...dimension,
        sub_dimensions: (dimension.sub_dimensions ?? []).map((subDimension) =>
          subDimension.key === subKey
            ? {
                ...subDimension,
                anchors: { ...subDimension.anchors, [score]: value },
              }
            : subDimension,
        ),
      })),
    );
  }

  async function saveDraft(): Promise<string | null> {
    if (!profile) {
      setFeedback({ tone: "error", text: "Rubric profile is missing for this role. Sync Ashby roles before saving." });
      return null;
    }
    if (selectionError) {
      setFeedback({ tone: "error", text: selectionError });
      return null;
    }

    setSaveState("saving");
    setFeedback(null);
    try {
      const response = await fetch(`/api/grading/profiles/${encodeURIComponent(profile.profile_id)}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobName: selectedRole.name,
          rubric: currentRubric,
        }),
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not save rubric draft.") });
        return null;
      }
      const nextVersionId =
        payload && typeof payload === "object" && "rubricVersionId" in payload && typeof payload.rubricVersionId === "string"
          ? payload.rubricVersionId
          : null;
      setDraftVersionId(nextVersionId);
      setFeedback({ tone: "success", text: "Rubric draft saved." });
      return nextVersionId;
    } catch {
      setFeedback({ tone: "error", text: "Could not reach the grading API." });
      return null;
    } finally {
      setSaveState("idle");
    }
  }

  async function approveDraft() {
    if (!profile) {
      setFeedback({ tone: "error", text: "Rubric profile is missing for this role. Sync Ashby roles before approving." });
      return;
    }
    if (selectionError) {
      setFeedback({ tone: "error", text: selectionError });
      return;
    }

    const versionId = draftVersionId ?? persistedVersionId ?? await saveDraft();
    if (!versionId) {
      return;
    }

    setSaveState("approving");
    setFeedback(null);
    try {
      const response = await fetch(`/api/grading/profiles/${encodeURIComponent(profile.profile_id)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rubricVersionId: versionId,
          rubric: currentRubric,
        }),
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not approve rubric.") });
        return;
      }
      setDraftVersionId(null);
      setFeedback({ tone: "success", text: "Rubric approved for future grading." });
    } catch {
      setFeedback({ tone: "error", text: "Could not reach the grading API." });
    } finally {
      setSaveState("idle");
    }
  }

  if (!profile) {
    return (
      <EmptyState
        title={`${selectedRole.name} rubric profile is missing`}
        detail="Sync Ashby roles again so Puddle can create a grading profile for this role."
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={profile.draft_rubric ? "Draft" : profile.active_rubric ? "Active" : "Not configured"} />
            <span className="text-sm font-semibold text-slate-950">{selectedRole.name}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Select 3 to 6 Weave dimensions. Saved drafts persist when you return to this role; approved rubrics drive future grading prompts.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled || Boolean(selectionError)}
            onClick={() => void saveDraft()}
            className={cx(secondaryButtonClass, "disabled:cursor-not-allowed disabled:opacity-60")}
          >
            {saveState === "saving" ? "Saving..." : "Save draft"}
          </button>
          <button
            type="button"
            disabled={disabled || Boolean(selectionError)}
            onClick={() => void approveDraft()}
            className={cx(primaryButtonClass, "disabled:cursor-not-allowed disabled:bg-slate-400")}
          >
            {saveState === "approving" ? "Approving..." : "Approve"}
          </button>
        </div>
      </div>

      <section className="rounded-md border border-slate-200 bg-white px-3 py-3">
        <div className="text-sm font-semibold text-slate-950">Dimensions</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {weaveDimensionKeys.map((key) => {
            const dimension = weaveDimensionLibrary[key];
            const checked = selectedDimensionKeys.includes(key);
            return (
              <label
                key={key}
                className={cx(
                  "flex min-h-14 items-start gap-3 rounded-md border px-3 py-2 text-sm transition",
                  checked ? "border-cyan-200 bg-cyan-50/70" : "border-slate-200 bg-white",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-cyan-700"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => toggleDimension(key, event.currentTarget.checked)}
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-950">{dimension.name}</span>
                  <span className="block text-xs leading-5 text-slate-500">{dimension.meaning}</span>
                </span>
              </label>
            );
          })}
        </div>
        {selectionError ? <p className="mt-2 text-sm font-medium text-rose-700">{selectionError}</p> : null}
      </section>

      <div className="grid gap-3">
        {dimensions.map((dimension) => (
          <section key={dimension.key} className="rounded-md border border-slate-200 bg-white px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">{dimension.name}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{dimension.meaning}</p>
              </div>
              <StatusPill status={dimension.key} />
            </div>
            <TableScroller>
              <table className="mt-3 min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="w-16 border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                      Score
                    </th>
                    <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                      Anchor
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {["1", "2", "3", "4"].map((score) => (
                    <tr key={score}>
                      <td className="border-b border-slate-100 px-2 py-2 font-semibold text-slate-700">{score}</td>
                      <td className="border-b border-slate-100 px-2 py-2">
                        <input
                          value={dimension.anchors[score] ?? ""}
                          disabled={disabled}
                          onChange={(event) => updateAnchor(dimension.key, score, event.target.value)}
                          className="min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroller>

            {dimension.sub_dimensions?.length ? (
              <div className="mt-4 grid gap-3">
                <div className="text-sm font-semibold text-slate-950">Sub-dimensions</div>
                {dimension.sub_dimensions.map((subDimension) => (
                  <div key={subDimension.key} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="text-sm font-semibold text-slate-900">{subDimension.name}</div>
                    <div className="mt-2 grid gap-2">
                      {["1", "2", "3", "4"].map((score) => (
                        <label key={score} className="grid gap-1 text-xs font-semibold text-slate-500">
                          Score {score}
                          <input
                            value={subDimension.anchors[score] ?? ""}
                            disabled={disabled}
                            onChange={(event) => updateSubAnchor(dimension.key, subDimension.key, score, event.target.value)}
                            className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm font-normal text-slate-950 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>

      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={cx("text-sm font-medium", feedback.tone === "error" ? "text-rose-700" : "text-emerald-700")}
        >
          {feedback.text}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Remove unused helper**

If `dimensionByKey` is unused after creating the editor, delete the function from `RoleRubricEditor.tsx`.

- [ ] **Step 3: Run role-rubric source test**

Run:

```bash
cd platform && pnpm test -- tests/role-rubric-source.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run dashboard source tests**

Run:

```bash
cd platform && pnpm test -- tests/dashboard-foundation-source.test.mjs tests/org-access-source.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit rubric editor**

```bash
git add platform/app/dashboard/roles/[roleId]/role-rubric-model.ts platform/app/dashboard/roles/[roleId]/RoleRubricEditor.tsx platform/app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx platform/app/dashboard/roles/[roleId]/page.tsx platform/tests/role-rubric-source.test.mjs platform/tests/dashboard-foundation-source.test.mjs
git commit -m "feat(platform): add role rubric editor"
```

---

### Task 8: Full Verification

**Files:**
- Review: all changed backend and platform files.

- [ ] **Step 1: Run backend grading tests**

Run:

```bash
cd backend && pnpm test -- grading-rubric.test.ts grading-routes.test.ts grading-scoring.test.ts grading-recommendation.test.ts grading-session-recommendations.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run platform focused tests**

Run:

```bash
cd platform && pnpm test -- tests/role-rubric-source.test.mjs tests/dashboard-foundation-source.test.mjs tests/org-access-source.test.mjs tests/backend-api-helper.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript builds**

Run:

```bash
pnpm --filter @puddle/backend build
pnpm --filter @puddle/platform build
```

Expected: both builds finish without TypeScript or Next.js errors.

- [ ] **Step 4: Check worktree**

Run:

```bash
git status --short
```

Expected: only intentional changes from this feature are present. Existing unrelated user changes may still be present; do not revert them.

- [ ] **Step 5: Manual browser check**

Start the platform and backend with the repo's connected-dev command:

```bash
pnpm dev:connected
```

Manual checks:

- Open a role workspace and click `Rubric`.
- Confirm an existing active or draft rubric appears when present.
- Select 3 dimensions and confirm Save draft is enabled.
- Select 2 dimensions and confirm the editor blocks save with "Select at least 3 dimensions."
- Add Passion for Sales and confirm the three sub-dimensions render.
- Save draft, refresh the role page, and confirm the saved content appears.
- Approve the draft and confirm future recommendation generation uses the approved rubric version.

- [ ] **Step 6: Final commit if verification changed files**

If verification requires small fixes, commit them:

```bash
git add backend platform
git commit -m "fix: polish role rubric v1"
```

If no fixes are needed, do not create an empty commit.
