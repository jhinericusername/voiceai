export type PipelineStatus =
  | "Sourced"
  | "Invited"
  | "In progress"
  | "Recording finalizing"
  | "Review ready"
  | "Reviewed"
  | "Advanced"
  | "Passed";

export type SessionLifecycleStatus =
  | "Scheduled"
  | "In progress"
  | "Recording finalizing"
  | "Review ready"
  | "Incomplete";

export type ReviewStatus = "Unreviewed" | "In review" | "Reviewed";
export type Recommendation = "Advance" | "Hold" | "Pass";
export type RiskLevel = "Very low" | "Low" | "Medium-low" | "Medium" | "High";

export interface RubricDimension {
  readonly name: string;
  readonly weight: number;
  readonly belowBar: string;
  readonly atBar: string;
  readonly aboveBar: string;
}

export interface RequiredQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly dimension: string;
}

export interface DemoRole {
  readonly id: string;
  readonly title: string;
  readonly department: string;
  readonly location: string;
  readonly level: string;
  readonly owner: string;
  readonly status: "Active" | "Paused" | "Closing";
  readonly hiringBar: string;
  readonly rubricVersion: string;
  readonly rubricUpdatedAt: string;
  readonly usedByInterviews: number;
  readonly openedAt: string;
  readonly targetHires: number;
  readonly sourcedCount: number;
  readonly screenedCount: number;
  readonly reviewReadyCount: number;
  readonly advancedCount: number;
  readonly passedCount: number;
  readonly avgScreenLengthMinutes: number;
  readonly flaggedIntegrityItems: number;
  readonly dimensions: readonly RubricDimension[];
  readonly requiredQuestions: readonly RequiredQuestion[];
}

export interface ScorecardRow {
  readonly dimension: string;
  readonly score: number;
  readonly maxScore: number;
  readonly barSignal: "Below bar" | "At bar" | "Above bar";
  readonly note: string;
  readonly evidence: string;
}

export interface QuestionCoverage {
  readonly question: string;
  readonly status: "Asked" | "Partially asked" | "Missed";
  readonly evidence: string;
}

export interface TranscriptExcerpt {
  readonly timestamp: string;
  readonly speaker: "Interviewer" | "Candidate";
  readonly question: string;
  readonly quote: string;
}

export interface AuthenticitySignal {
  readonly signal: string;
  readonly rating: RiskLevel;
  readonly detail: string;
}

export interface DemoArtifact {
  readonly label: string;
  readonly status: "Available" | "Finalizing" | "Missing";
  readonly detail: string;
}

export interface InterviewMediaSummary {
  readonly videoStatus: DemoArtifact["status"];
  readonly audioStatus: DemoArtifact["status"];
  readonly transcriptStatus: DemoArtifact["status"];
  readonly durationLabel: string;
  readonly playbackPositionLabel: string;
  readonly note: string;
}

export interface InterviewMediaMarker {
  readonly timestamp: string;
  readonly label: string;
  readonly type: "Evidence" | "Question" | "Integrity";
  readonly detail: string;
}

export interface InterviewTranscriptTurn {
  readonly timestamp: string;
  readonly speaker: "Interviewer" | "Candidate";
  readonly question: string;
  readonly text: string;
  readonly evidenceTags: readonly string[];
  readonly risk?: RiskLevel;
}

export interface InterviewReviewSummary {
  readonly owner: string;
  readonly dueAt: string;
  readonly recommendationRationale: string;
  readonly reviewFocus: readonly string[];
}

export interface DemoCandidate {
  readonly id: string;
  readonly roleId: string;
  readonly name: string;
  readonly initials: string;
  readonly email: string;
  readonly source: string;
  readonly pipelineStatus: PipelineStatus;
  readonly reviewStatus: ReviewStatus;
  readonly score: number | null;
  readonly maxScore: number;
  readonly recommendation: Recommendation | null;
  readonly aiRisk: RiskLevel;
  readonly aiRiskPercent: number;
  readonly integrityFlags: number;
  readonly reviewer: string;
  readonly lastActivityAt: string;
  readonly screenLengthMinutes: number | null;
  readonly sessionId: string | null;
  readonly inviteStatus: "Not sent" | "Sent" | "Opened" | "Joined" | "Expired";
  readonly inviteExpiresAt: string | null;
  readonly joinCount: number;
  readonly scorecard: readonly ScorecardRow[];
  readonly questionCoverage: readonly QuestionCoverage[];
  readonly transcriptExcerpts: readonly TranscriptExcerpt[];
  readonly authenticitySignals: readonly AuthenticitySignal[];
  readonly artifacts: readonly DemoArtifact[];
}

export interface SessionTimelineEvent {
  readonly at: string;
  readonly label: string;
  readonly detail: string;
  readonly severity: "info" | "success" | "warning";
}

export interface DemoSession {
  readonly id: string;
  readonly roleId: string;
  readonly candidateId: string;
  readonly lifecycleStatus: SessionLifecycleStatus;
  readonly inviteState: "Created" | "Sent" | "Opened" | "Joined" | "Expired";
  readonly consentState: "Not requested" | "Accepted" | "Declined";
  readonly roomName: string;
  readonly recordingState: "Not started" | "Recording" | "Finalizing" | "Available" | "Failed";
  readonly scheduledAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationMinutes: number | null;
  readonly scriptVersion: string;
  readonly media: InterviewMediaSummary;
  readonly markers: readonly InterviewMediaMarker[];
  readonly transcript: readonly InterviewTranscriptTurn[];
  readonly reviewSummary: InterviewReviewSummary;
  readonly artifactChecklist: readonly DemoArtifact[];
  readonly transcriptPreview: readonly TranscriptExcerpt[];
  readonly timeline: readonly SessionTimelineEvent[];
}

export interface DemoActivity {
  readonly id: string;
  readonly roleId: string;
  readonly candidateId: string | null;
  readonly sessionId: string | null;
  readonly title: string;
  readonly detail: string;
  readonly happenedAt: string;
  readonly severity: "info" | "success" | "warning";
}

export interface ReviewPacket {
  readonly session: DemoSession;
  readonly candidate: DemoCandidate;
  readonly role: DemoRole;
  readonly updatedAt: string;
  readonly packetAgeHours: number;
  readonly artifactReadiness: string;
}

export const pipelineStatusOrder: readonly PipelineStatus[] = [
  "Sourced",
  "Invited",
  "In progress",
  "Recording finalizing",
  "Review ready",
  "Reviewed",
  "Advanced",
  "Passed",
];

const DEMO_NOW = new Date("2026-06-01T21:00:00.000Z");
const DEMO_TODAY = "2026-06-01";

/**
 * Role fixtures.
 * Source mapping:
 * - roles: title, department, level, owner, status, target hires, opened timestamp.
 * - role_rubrics / assessments: rubric version, dimensions, scoring scale, required questions.
 * - sessions / assessments: screened, review-ready, advanced, passed, average screen length.
 */
export const demoRoles: readonly DemoRole[] = [
  {
    id: "founding-fullstack-engineer",
    title: "Founding Full Stack Engineer",
    department: "Engineering",
    location: "San Francisco / Remote",
    level: "Senior IC",
    owner: "Anika Rao",
    status: "Active",
    hiringBar: "High-agency product engineer who can ship ambiguous systems end to end.",
    rubricVersion: "v3.2",
    rubricUpdatedAt: "2026-05-24T17:00:00.000Z",
    usedByInterviews: 18,
    openedAt: "2026-05-02T16:00:00.000Z",
    targetHires: 2,
    sourcedCount: 42,
    screenedCount: 18,
    reviewReadyCount: 4,
    advancedCount: 3,
    passedCount: 8,
    avgScreenLengthMinutes: 14,
    flaggedIntegrityItems: 2,
    dimensions: [
      {
        name: "Problem solving",
        weight: 4,
        belowBar: "Describes implementation steps but does not isolate tradeoffs or failure modes.",
        atBar: "Frames constraints, proposes a workable approach, and explains the debugging path.",
        aboveBar: "Finds leverage, names risks early, and adapts when the interviewer changes constraints.",
      },
      {
        name: "Agency",
        weight: 4,
        belowBar: "Waits for direction or keeps ownership narrow.",
        atBar: "Shows examples of taking ambiguous work from problem to shipped result.",
        aboveBar: "Creates momentum across product, infra, and customer constraints without being asked.",
      },
      {
        name: "Product judgment",
        weight: 4,
        belowBar: "Optimizes for technical elegance without a clear user or business reason.",
        atBar: "Connects implementation choices to user impact and sequencing.",
        aboveBar: "Prioritizes ruthlessly and identifies the smallest credible launch path.",
      },
      {
        name: "Communication",
        weight: 4,
        belowBar: "Answers are vague, overlong, or hard to inspect.",
        atBar: "Gives crisp examples with enough detail for follow-up review.",
        aboveBar: "Makes tradeoffs legible and helps reviewers calibrate quickly.",
      },
    ],
    requiredQuestions: [
      {
        id: "fs-q1",
        prompt: "Walk through a production issue where you personally found the root cause.",
        dimension: "Problem solving",
      },
      {
        id: "fs-q2",
        prompt: "Tell me about a time you created momentum without a clear owner.",
        dimension: "Agency",
      },
      {
        id: "fs-q3",
        prompt: "What product tradeoff did you make that made the code less elegant but the user outcome better?",
        dimension: "Product judgment",
      },
      {
        id: "fs-q4",
        prompt: "Explain a technical decision you had to make to non-engineers.",
        dimension: "Communication",
      },
    ],
  },
  {
    id: "ai-infra-engineer",
    title: "AI Infrastructure Engineer",
    department: "Engineering",
    location: "New York / Remote",
    level: "Staff IC",
    owner: "Marcus Lee",
    status: "Active",
    hiringBar: "Systems engineer who can make model workflows reliable under real traffic.",
    rubricVersion: "v2.7",
    rubricUpdatedAt: "2026-05-20T19:30:00.000Z",
    usedByInterviews: 11,
    openedAt: "2026-05-08T15:00:00.000Z",
    targetHires: 1,
    sourcedCount: 28,
    screenedCount: 11,
    reviewReadyCount: 2,
    advancedCount: 1,
    passedCount: 4,
    avgScreenLengthMinutes: 16,
    flaggedIntegrityItems: 1,
    dimensions: [
      {
        name: "Distributed systems",
        weight: 4,
        belowBar: "Speaks in generic reliability language without concrete incidents.",
        atBar: "Explains latency, backpressure, rollout, and observability tradeoffs.",
        aboveBar: "Anticipates cascading failures and designs graceful degradation paths.",
      },
      {
        name: "Model operations",
        weight: 4,
        belowBar: "Treats model calls as a black box.",
        atBar: "Understands evals, rate limits, cost controls, and prompt/version rollout.",
        aboveBar: "Builds production feedback loops that improve quality and cost together.",
      },
      {
        name: "Incident ownership",
        weight: 4,
        belowBar: "Describes incidents passively or focuses on blame.",
        atBar: "Shows calm diagnosis, communication, mitigation, and follow-through.",
        aboveBar: "Improves the system and process so the same class of incident is less likely.",
      },
      {
        name: "Clarity",
        weight: 4,
        belowBar: "Cannot make systems behavior understandable without diagrams or jargon.",
        atBar: "Explains a complex system in layers with concrete examples.",
        aboveBar: "Teaches the architecture while preserving nuance and uncertainty.",
      },
    ],
    requiredQuestions: [
      {
        id: "ai-q1",
        prompt: "Describe the highest-severity production incident you owned end to end.",
        dimension: "Incident ownership",
      },
      {
        id: "ai-q2",
        prompt: "How would you protect an LLM workflow from latency spikes and provider failures?",
        dimension: "Distributed systems",
      },
      {
        id: "ai-q3",
        prompt: "What eval or monitoring signal changed your model rollout decision?",
        dimension: "Model operations",
      },
      {
        id: "ai-q4",
        prompt: "Explain a model-serving architecture to a product lead.",
        dimension: "Clarity",
      },
    ],
  },
  {
    id: "developer-relations-lead",
    title: "Developer Relations Lead",
    department: "GTM",
    location: "Remote US",
    level: "Lead",
    owner: "Priya Shah",
    status: "Paused",
    hiringBar: "Technical communicator who turns messy developer feedback into product motion.",
    rubricVersion: "v1.9",
    rubricUpdatedAt: "2026-05-12T18:45:00.000Z",
    usedByInterviews: 6,
    openedAt: "2026-04-22T14:00:00.000Z",
    targetHires: 1,
    sourcedCount: 19,
    screenedCount: 6,
    reviewReadyCount: 0,
    advancedCount: 1,
    passedCount: 3,
    avgScreenLengthMinutes: 13,
    flaggedIntegrityItems: 0,
    dimensions: [
      {
        name: "Technical depth",
        weight: 4,
        belowBar: "Can present APIs but cannot reason through implementation friction.",
        atBar: "Understands developer workflows and can debug common integration issues.",
        aboveBar: "Earns credibility with senior engineers through precise technical judgment.",
      },
      {
        name: "Narrative",
        weight: 4,
        belowBar: "Creates content that is polished but generic.",
        atBar: "Turns product value into specific developer stories and examples.",
        aboveBar: "Creates durable narratives that shape community and product direction.",
      },
      {
        name: "Feedback loops",
        weight: 4,
        belowBar: "Collects anecdotes without prioritization.",
        atBar: "Synthesizes developer feedback into product and docs changes.",
        aboveBar: "Builds repeatable loops that improve roadmap, docs, and adoption.",
      },
      {
        name: "Community judgment",
        weight: 4,
        belowBar: "Confuses audience growth with trust.",
        atBar: "Chooses programs that match the developer audience and product stage.",
        aboveBar: "Builds trust while keeping commercial goals clear.",
      },
    ],
    requiredQuestions: [
      {
        id: "devrel-q1",
        prompt: "Show how you would explain a complex API feature to a skeptical developer.",
        dimension: "Narrative",
      },
      {
        id: "devrel-q2",
        prompt: "Tell me about a time developer feedback changed a product decision.",
        dimension: "Feedback loops",
      },
      {
        id: "devrel-q3",
        prompt: "How do you decide whether to invest in content, community, or direct support?",
        dimension: "Community judgment",
      },
      {
        id: "devrel-q4",
        prompt: "Debug a hypothetical SDK integration issue out loud.",
        dimension: "Technical depth",
      },
    ],
  },
];

const foundingScorecardStrong: readonly ScorecardRow[] = [
  {
    dimension: "Problem solving",
    score: 4,
    maxScore: 4,
    barSignal: "Above bar",
    note: "Isolated a race condition with concrete instrumentation and named the rollback path before optimizing.",
    evidence: "Detailed incident narrative with metrics, logs, and a narrow reproduction strategy.",
  },
  {
    dimension: "Agency",
    score: 4,
    maxScore: 4,
    barSignal: "Above bar",
    note: "Created a customer-facing migration plan when no team had clear ownership.",
    evidence: "Pulled product, support, and infra into a two-day launch plan with explicit checkpoints.",
  },
  {
    dimension: "Product judgment",
    score: 3,
    maxScore: 4,
    barSignal: "At bar",
    note: "Chose the less flexible implementation because it removed a launch-blocking onboarding step.",
    evidence: "Tradeoff was user-centered, though the success metric was only directionally defined.",
  },
  {
    dimension: "Communication",
    score: 3,
    maxScore: 4,
    barSignal: "At bar",
    note: "Answers were concise and easy to inspect, with enough detail for follow-up.",
    evidence: "Explained a technical migration clearly, but could have named more alternatives.",
  },
];

const foundingScorecardMixed: readonly ScorecardRow[] = [
  {
    dimension: "Problem solving",
    score: 2,
    maxScore: 4,
    barSignal: "Below bar",
    note: "Found a plausible solution but did not stress-test edge cases when constraints changed.",
    evidence: "Debugging story stayed high level after the second follow-up.",
  },
  {
    dimension: "Agency",
    score: 3,
    maxScore: 4,
    barSignal: "At bar",
    note: "Strong owner mindset in a messy migration, though impact was bounded to one team.",
    evidence: "Clear example of writing the plan, aligning stakeholders, and shipping.",
  },
  {
    dimension: "Product judgment",
    score: 2,
    maxScore: 4,
    barSignal: "Below bar",
    note: "Optimized for implementation neatness before naming the customer consequence.",
    evidence: "Needed prompting to identify user-facing risk.",
  },
  {
    dimension: "Communication",
    score: 2,
    maxScore: 4,
    barSignal: "Below bar",
    note: "Conversational but occasionally abstract when evidence was requested.",
    evidence: "Specificity dropped on the product tradeoff prompt.",
  },
];

const aiInfraScorecard: readonly ScorecardRow[] = [
  {
    dimension: "Distributed systems",
    score: 3,
    maxScore: 4,
    barSignal: "At bar",
    note: "Covered queue isolation, provider fallback, and latency budgets with practical defaults.",
    evidence: "Named SLOs, backoff behavior, and circuit-breaker thresholds.",
  },
  {
    dimension: "Model operations",
    score: 4,
    maxScore: 4,
    barSignal: "Above bar",
    note: "Strong understanding of eval drift, prompt versioning, and cost-quality tradeoffs.",
    evidence: "Gave a detailed rollout plan with holdout evals and manual review gates.",
  },
  {
    dimension: "Incident ownership",
    score: 3,
    maxScore: 4,
    barSignal: "At bar",
    note: "Good incident discipline and clear postmortem ownership.",
    evidence: "Walked through mitigation, comms, and follow-up instrumentation.",
  },
  {
    dimension: "Clarity",
    score: 3,
    maxScore: 4,
    barSignal: "At bar",
    note: "Explained architecture in layers and handled product-lead framing well.",
    evidence: "Used clear language without flattening the technical risk.",
  },
];

const foundingCoverage: readonly QuestionCoverage[] = [
  {
    question: "Production root-cause story",
    status: "Asked",
    evidence: "Candidate described a checkout race condition and how they reproduced it.",
  },
  {
    question: "Created momentum without owner",
    status: "Asked",
    evidence: "Candidate owned a cross-team migration plan after a customer escalation.",
  },
  {
    question: "Product tradeoff over code elegance",
    status: "Asked",
    evidence: "Candidate discussed reducing configurability to unblock onboarding.",
  },
  {
    question: "Explained technical decision to non-engineers",
    status: "Asked",
    evidence: "Candidate described a migration timeline to support and customer success.",
  },
];

const foundingPartialCoverage: readonly QuestionCoverage[] = [
  {
    question: "Production root-cause story",
    status: "Asked",
    evidence: "Candidate provided a plausible incident but few metrics.",
  },
  {
    question: "Created momentum without owner",
    status: "Asked",
    evidence: "Candidate gave a concrete migration example.",
  },
  {
    question: "Product tradeoff over code elegance",
    status: "Partially asked",
    evidence: "Follow-up was cut short after the candidate moved back to architecture details.",
  },
  {
    question: "Explained technical decision to non-engineers",
    status: "Asked",
    evidence: "Candidate gave a short but understandable explanation.",
  },
];

const lowRiskSignals: readonly AuthenticitySignal[] = [
  {
    signal: "Scripted likelihood",
    rating: "Low",
    detail: "Answers included natural pauses and corrections under follow-up.",
  },
  {
    signal: "Live AI assistance",
    rating: "Very low",
    detail: "No timing spikes or reading cadence detected during technical answers.",
  },
  {
    signal: "Buzzword density",
    rating: "Medium-low",
    detail: "Some standard startup language, but examples stayed concrete.",
  },
  {
    signal: "Follow-up resilience",
    rating: "Low",
    detail: "Candidate handled constraint changes without collapsing into generic answers.",
  },
];

const mediumRiskSignals: readonly AuthenticitySignal[] = [
  {
    signal: "Scripted likelihood",
    rating: "Medium",
    detail: "Several answers started polished and became vague after interruptions.",
  },
  {
    signal: "Live AI assistance",
    rating: "Low",
    detail: "No direct evidence of live assistance, but two pauses were longer than baseline.",
  },
  {
    signal: "Buzzword density",
    rating: "Medium",
    detail: "Frequent generic platform language with fewer named artifacts.",
  },
  {
    signal: "Follow-up resilience",
    rating: "Medium",
    detail: "Follow-up answers narrowed quickly and did not add much new evidence.",
  },
];

const availableArtifacts: readonly DemoArtifact[] = [
  {
    label: "Video recording",
    status: "Available",
    detail: "Full recording is attached to the review packet.",
  },
  {
    label: "Transcript",
    status: "Available",
    detail: "Speaker-labeled transcript has completed post-processing.",
  },
  {
    label: "Scorecard",
    status: "Available",
    detail: "Rubric scores are ready for reviewer calibration.",
  },
  {
    label: "Integrity audit",
    status: "Available",
    detail: "Timing and authenticity signals are available.",
  },
];

const finalizingArtifacts: readonly DemoArtifact[] = [
  {
    label: "Video recording",
    status: "Finalizing",
    detail: "Egress job completed; asset is still being copied.",
  },
  {
    label: "Transcript",
    status: "Finalizing",
    detail: "Transcript is queued behind recording finalization.",
  },
  {
    label: "Scorecard",
    status: "Missing",
    detail: "Assessment waits for transcript completion.",
  },
  {
    label: "Integrity audit",
    status: "Available",
    detail: "Room events and timing signals are attached.",
  },
];

const missingMedia: InterviewMediaSummary = {
  videoStatus: "Missing",
  audioStatus: "Missing",
  transcriptStatus: "Missing",
  durationLabel: "Pending",
  playbackPositionLabel: "00:00",
  note: "Media appears here after the candidate joins and recording starts.",
};

const liveMedia: InterviewMediaSummary = {
  videoStatus: "Finalizing",
  audioStatus: "Finalizing",
  transcriptStatus: "Missing",
  durationLabel: "Live",
  playbackPositionLabel: "08:14",
  note: "Recording is active. Transcript and review artifacts unlock after the room ends.",
};

const finalizingMedia: InterviewMediaSummary = {
  videoStatus: "Finalizing",
  audioStatus: "Finalizing",
  transcriptStatus: "Finalizing",
  durationLabel: "15:22",
  playbackPositionLabel: "15:22",
  note: "Video and audio are copying before transcript post-processing completes.",
};

const mayaTranscript: readonly InterviewTranscriptTurn[] = [
  {
    timestamp: "00:02:11",
    speaker: "Interviewer",
    question: "Warmup",
    text: "I am going to ask for specific examples and then follow up on tradeoffs.",
    evidenceTags: ["Interview setup"],
  },
  {
    timestamp: "00:04:18",
    speaker: "Candidate",
    question: "Production root-cause story",
    text:
      "The symptom looked like a payment retry issue, but the duplicate charge only happened when the webhook arrived before our local write completed.",
    evidenceTags: ["Problem solving", "Root cause"],
  },
  {
    timestamp: "00:08:42",
    speaker: "Candidate",
    question: "Created momentum without owner",
    text:
      "Nobody owned the migration, so I wrote the customer-facing plan first, then split the engineering work around the dates support had already promised.",
    evidenceTags: ["Agency", "Cross-functional ownership"],
  },
  {
    timestamp: "00:12:09",
    speaker: "Candidate",
    question: "Product tradeoff over code elegance",
    text:
      "We removed two configuration branches because the implementation was cleaner with them, but onboarding was failing when users had to choose.",
    evidenceTags: ["Product judgment", "User impact"],
  },
];

const mayaMarkers: readonly InterviewMediaMarker[] = [
  {
    timestamp: "00:04:18",
    label: "Root cause evidence",
    type: "Evidence",
    detail: "Candidate isolates ordering bug and names reproduction path.",
  },
  {
    timestamp: "00:08:42",
    label: "Agency evidence",
    type: "Evidence",
    detail: "Candidate describes taking ownership across product, support, and infra.",
  },
  {
    timestamp: "00:12:09",
    label: "Product tradeoff",
    type: "Question",
    detail: "Answer ties implementation simplification to onboarding failure.",
  },
];

const nolanTranscript: readonly InterviewTranscriptTurn[] = [
  {
    timestamp: "00:01:44",
    speaker: "Interviewer",
    question: "Production root-cause story",
    text: "Walk me through the incident from first alert to the moment you knew the root cause.",
    evidenceTags: ["Question"],
  },
  {
    timestamp: "00:03:55",
    speaker: "Candidate",
    question: "Production root-cause story",
    text:
      "We had a caching layer that was not invalidating, and I coordinated the fix with the API team and support.",
    evidenceTags: ["Problem solving"],
  },
  {
    timestamp: "00:06:18",
    speaker: "Interviewer",
    question: "Production root-cause story",
    text: "What metric told you that was the root cause rather than another downstream effect?",
    evidenceTags: ["Probe"],
  },
  {
    timestamp: "00:06:52",
    speaker: "Candidate",
    question: "Production root-cause story",
    text: "I do not remember the exact metric, but the dashboards showed stale reads dropping after the fix.",
    evidenceTags: ["Low specificity"],
    risk: "Medium",
  },
  {
    timestamp: "00:09:21",
    speaker: "Candidate",
    question: "Product tradeoff over code elegance",
    text:
      "I would probably still choose the cleaner abstraction, but I understand there are times when speed is more important.",
    evidenceTags: ["Product judgment", "Below bar"],
  },
];

const nolanMarkers: readonly InterviewMediaMarker[] = [
  {
    timestamp: "00:03:55",
    label: "High-level incident answer",
    type: "Evidence",
    detail: "Candidate gives plausible incident but lacks metrics.",
  },
  {
    timestamp: "00:06:52",
    label: "Specificity drops",
    type: "Integrity",
    detail: "Follow-up answer becomes vague after direct metric probe.",
  },
  {
    timestamp: "00:09:21",
    label: "Product tradeoff concern",
    type: "Question",
    detail: "Candidate defaults to implementation cleanliness over user outcome.",
  },
];

const emmaTranscript: readonly InterviewTranscriptTurn[] = [
  {
    timestamp: "00:02:48",
    speaker: "Candidate",
    question: "Production incident ownership",
    text: "The provider outage mattered less than our failure to isolate workloads by customer promise.",
    evidenceTags: ["Incident ownership"],
  },
  {
    timestamp: "00:06:36",
    speaker: "Candidate",
    question: "Latency and provider failures",
    text: "The fallback is not just another provider. It is a degraded product mode with a different latency promise.",
    evidenceTags: ["Distributed systems", "Fallback design"],
  },
  {
    timestamp: "00:11:02",
    speaker: "Candidate",
    question: "Eval signal changed rollout",
    text: "We stopped the rollout when the holdout eval showed summarization quality regressing for longer support threads.",
    evidenceTags: ["Model operations", "Rollout discipline"],
  },
];

const emmaMarkers: readonly InterviewMediaMarker[] = [
  {
    timestamp: "00:06:36",
    label: "Fallback architecture",
    type: "Evidence",
    detail: "Candidate distinguishes provider fallback from product degradation mode.",
  },
  {
    timestamp: "00:11:02",
    label: "Eval-gated rollout",
    type: "Evidence",
    detail: "Candidate ties eval drift to a deployment decision.",
  },
];

const elenaTranscript: readonly InterviewTranscriptTurn[] = [
  {
    timestamp: "00:05:04",
    speaker: "Candidate",
    question: "Production root-cause story",
    text: "The key was accepting that the failure was in our mental model of the queue, not in the queue itself.",
    evidenceTags: ["Problem solving", "Systems thinking"],
  },
];

const elenaMarkers: readonly InterviewMediaMarker[] = [
  {
    timestamp: "00:05:04",
    label: "Systems framing",
    type: "Evidence",
    detail: "Candidate reframes incident around queue model and ownership.",
  },
];

const emptyReviewSummary: InterviewReviewSummary = {
  owner: "Unassigned",
  dueAt: "2026-06-02T17:00:00.000Z",
  recommendationRationale: "Review packet is not ready yet.",
  reviewFocus: ["Wait for recording, transcript, and scorecard artifacts."],
};

/**
 * Candidate fixtures.
 * Source mapping:
 * - candidate_invites: invite status, expiry, join count.
 * - assessments: category scores, integrity flags, reviewer signoff, recommendation.
 * - transcript_turns: transcript excerpts and required-question coverage.
 * - recordings / recording_artifacts: recording state and artifact availability.
 */
export const demoCandidates: readonly DemoCandidate[] = [
  {
    id: "maya-chen",
    roleId: "founding-fullstack-engineer",
    name: "Maya C.",
    initials: "MC",
    email: "maya.c@example.com",
    source: "YC founder referral",
    pipelineStatus: "Review ready",
    reviewStatus: "Unreviewed",
    score: 14,
    maxScore: 16,
    recommendation: "Advance",
    aiRisk: "Low",
    aiRiskPercent: 8,
    integrityFlags: 0,
    reviewer: "Unassigned",
    lastActivityAt: "2026-05-31T18:35:00.000Z",
    screenLengthMinutes: 15,
    sessionId: "sess-maya-2026-05-31",
    inviteStatus: "Joined",
    inviteExpiresAt: "2026-06-07T18:35:00.000Z",
    joinCount: 1,
    scorecard: foundingScorecardStrong,
    questionCoverage: foundingCoverage,
    transcriptExcerpts: [
      {
        timestamp: "00:04:18",
        speaker: "Candidate",
        question: "Production root-cause story",
        quote:
          "The symptom looked like a payment retry issue, but the duplicate charge only happened when the webhook arrived before our local write completed.",
      },
      {
        timestamp: "00:08:42",
        speaker: "Candidate",
        question: "Created momentum without owner",
        quote:
          "Nobody owned the migration, so I wrote the customer-facing plan first, then split the engineering work around the dates support had already promised.",
      },
      {
        timestamp: "00:12:09",
        speaker: "Candidate",
        question: "Product tradeoff over code elegance",
        quote:
          "We removed two configuration branches because the implementation was cleaner with them, but onboarding was failing when users had to choose.",
      },
    ],
    authenticitySignals: lowRiskSignals,
    artifacts: availableArtifacts,
  },
  {
    id: "nolan-patel",
    roleId: "founding-fullstack-engineer",
    name: "Nolan P.",
    initials: "NP",
    email: "nolan.p@example.com",
    source: "Inbound application",
    pipelineStatus: "Review ready",
    reviewStatus: "In review",
    score: 9,
    maxScore: 16,
    recommendation: "Hold",
    aiRisk: "Medium",
    aiRiskPercent: 28,
    integrityFlags: 1,
    reviewer: "Jordan Kim",
    lastActivityAt: "2026-05-31T16:10:00.000Z",
    screenLengthMinutes: 13,
    sessionId: "sess-nolan-2026-05-31",
    inviteStatus: "Joined",
    inviteExpiresAt: "2026-06-07T16:10:00.000Z",
    joinCount: 2,
    scorecard: foundingScorecardMixed,
    questionCoverage: foundingPartialCoverage,
    transcriptExcerpts: [
      {
        timestamp: "00:03:55",
        speaker: "Candidate",
        question: "Production root-cause story",
        quote:
          "We had a caching layer that was not invalidating, and I coordinated the fix with the API team and support.",
      },
      {
        timestamp: "00:09:21",
        speaker: "Candidate",
        question: "Product tradeoff over code elegance",
        quote:
          "I would probably still choose the cleaner abstraction, but I understand there are times when speed is more important.",
      },
    ],
    authenticitySignals: mediumRiskSignals,
    artifacts: availableArtifacts,
  },
  {
    id: "elena-garcia",
    roleId: "founding-fullstack-engineer",
    name: "Elena G.",
    initials: "EG",
    email: "elena.g@example.com",
    source: "Talent partner",
    pipelineStatus: "Advanced",
    reviewStatus: "Reviewed",
    score: 15,
    maxScore: 16,
    recommendation: "Advance",
    aiRisk: "Very low",
    aiRiskPercent: 5,
    integrityFlags: 0,
    reviewer: "Anika Rao",
    lastActivityAt: "2026-05-30T21:12:00.000Z",
    screenLengthMinutes: 14,
    sessionId: "sess-elena-2026-05-30",
    inviteStatus: "Joined",
    inviteExpiresAt: "2026-06-06T21:12:00.000Z",
    joinCount: 1,
    scorecard: foundingScorecardStrong,
    questionCoverage: foundingCoverage,
    transcriptExcerpts: [
      {
        timestamp: "00:05:04",
        speaker: "Candidate",
        question: "Production root-cause story",
        quote:
          "The key was accepting that the failure was in our mental model of the queue, not in the queue itself.",
      },
    ],
    authenticitySignals: lowRiskSignals,
    artifacts: availableArtifacts,
  },
  {
    id: "tariq-owens",
    roleId: "founding-fullstack-engineer",
    name: "Tariq O.",
    initials: "TO",
    email: "tariq.o@example.com",
    source: "GitHub sourcing",
    pipelineStatus: "Invited",
    reviewStatus: "Unreviewed",
    score: null,
    maxScore: 16,
    recommendation: null,
    aiRisk: "Low",
    aiRiskPercent: 0,
    integrityFlags: 0,
    reviewer: "Unassigned",
    lastActivityAt: "2026-05-31T13:30:00.000Z",
    screenLengthMinutes: null,
    sessionId: "sess-tariq-2026-06-02",
    inviteStatus: "Opened",
    inviteExpiresAt: "2026-06-07T13:30:00.000Z",
    joinCount: 0,
    scorecard: [],
    questionCoverage: [],
    transcriptExcerpts: [],
    authenticitySignals: [],
    artifacts: [],
  },
  {
    id: "zoe-kim",
    roleId: "founding-fullstack-engineer",
    name: "Zoe K.",
    initials: "ZK",
    email: "zoe.k@example.com",
    source: "Pear VC intro",
    pipelineStatus: "In progress",
    reviewStatus: "Unreviewed",
    score: null,
    maxScore: 16,
    recommendation: null,
    aiRisk: "Low",
    aiRiskPercent: 0,
    integrityFlags: 0,
    reviewer: "Unassigned",
    lastActivityAt: "2026-06-01T15:10:00.000Z",
    screenLengthMinutes: null,
    sessionId: "sess-zoe-2026-06-01",
    inviteStatus: "Joined",
    inviteExpiresAt: "2026-06-08T14:55:00.000Z",
    joinCount: 1,
    scorecard: [],
    questionCoverage: [],
    transcriptExcerpts: [],
    authenticitySignals: [],
    artifacts: [],
  },
  {
    id: "emma-wilson",
    roleId: "ai-infra-engineer",
    name: "Emma W.",
    initials: "EW",
    email: "emma.w@example.com",
    source: "Systems community",
    pipelineStatus: "Review ready",
    reviewStatus: "Unreviewed",
    score: 13,
    maxScore: 16,
    recommendation: "Advance",
    aiRisk: "Low",
    aiRiskPercent: 11,
    integrityFlags: 0,
    reviewer: "Unassigned",
    lastActivityAt: "2026-05-31T20:44:00.000Z",
    screenLengthMinutes: 16,
    sessionId: "sess-emma-2026-05-31",
    inviteStatus: "Joined",
    inviteExpiresAt: "2026-06-07T20:44:00.000Z",
    joinCount: 1,
    scorecard: aiInfraScorecard,
    questionCoverage: [
      {
        question: "Production incident ownership",
        status: "Asked",
        evidence: "Candidate described a provider outage mitigation with clear comms.",
      },
      {
        question: "Latency and provider failures",
        status: "Asked",
        evidence: "Candidate proposed queue isolation and fallback tiers.",
      },
      {
        question: "Eval signal changed rollout",
        status: "Asked",
        evidence: "Candidate discussed regression evals before ramping traffic.",
      },
      {
        question: "Architecture for product lead",
        status: "Asked",
        evidence: "Candidate explained serving layers in plain language.",
      },
    ],
    transcriptExcerpts: [
      {
        timestamp: "00:06:36",
        speaker: "Candidate",
        question: "Latency and provider failures",
        quote:
          "The fallback is not just another provider. It is a degraded product mode with a different latency promise.",
      },
    ],
    authenticitySignals: lowRiskSignals,
    artifacts: availableArtifacts,
  },
  {
    id: "samir-lee",
    roleId: "ai-infra-engineer",
    name: "Samir L.",
    initials: "SL",
    email: "samir.l@example.com",
    source: "Open source maintainer",
    pipelineStatus: "Recording finalizing",
    reviewStatus: "Unreviewed",
    score: null,
    maxScore: 16,
    recommendation: null,
    aiRisk: "Medium-low",
    aiRiskPercent: 14,
    integrityFlags: 1,
    reviewer: "Unassigned",
    lastActivityAt: "2026-06-01T16:05:00.000Z",
    screenLengthMinutes: 15,
    sessionId: "sess-samir-2026-06-01",
    inviteStatus: "Joined",
    inviteExpiresAt: "2026-06-08T15:25:00.000Z",
    joinCount: 1,
    scorecard: [],
    questionCoverage: [],
    transcriptExcerpts: [],
    authenticitySignals: mediumRiskSignals,
    artifacts: finalizingArtifacts,
  },
  {
    id: "priya-narayan",
    roleId: "developer-relations-lead",
    name: "Priya N.",
    initials: "PN",
    email: "priya.n@example.com",
    source: "Community referral",
    pipelineStatus: "Sourced",
    reviewStatus: "Unreviewed",
    score: null,
    maxScore: 16,
    recommendation: null,
    aiRisk: "Low",
    aiRiskPercent: 0,
    integrityFlags: 0,
    reviewer: "Unassigned",
    lastActivityAt: "2026-05-29T18:20:00.000Z",
    screenLengthMinutes: null,
    sessionId: null,
    inviteStatus: "Not sent",
    inviteExpiresAt: null,
    joinCount: 0,
    scorecard: [],
    questionCoverage: [],
    transcriptExcerpts: [],
    authenticitySignals: [],
    artifacts: [],
  },
];

/**
 * Session fixtures.
 * Source mapping:
 * - sessions: role/session status, candidate email, room, timestamps, script version.
 * - consent_records: disclosure and recording consent state.
 * - recordings / recording_artifacts: recording state and artifact checklist.
 * - transcript_turns: transcript preview excerpts.
 * - audit_log / events: lifecycle timeline and integrity/audit events.
 */
export const demoSessions: readonly DemoSession[] = [
  {
    id: "sess-maya-2026-05-31",
    roleId: "founding-fullstack-engineer",
    candidateId: "maya-chen",
    lifecycleStatus: "Review ready",
    inviteState: "Joined",
    consentState: "Accepted",
    roomName: "puddle-fs-maya-8f42",
    recordingState: "Available",
    scheduledAt: "2026-05-31T18:15:00.000Z",
    startedAt: "2026-05-31T18:17:00.000Z",
    endedAt: "2026-05-31T18:32:00.000Z",
    durationMinutes: 15,
    scriptVersion: "founding-fs-v3.2",
    media: {
      videoStatus: "Available",
      audioStatus: "Available",
      transcriptStatus: "Available",
      durationLabel: "15:02",
      playbackPositionLabel: "04:18",
      note: "Video, audio, transcript, and scorecard are ready for human review.",
    },
    markers: mayaMarkers,
    transcript: mayaTranscript,
    reviewSummary: {
      owner: "Unassigned",
      dueAt: "2026-06-01T22:00:00.000Z",
      recommendationRationale:
        "Advance recommendation is supported by above-bar problem solving and agency, with clear transcript evidence and no integrity flags.",
      reviewFocus: [
        "Confirm the product judgment score is calibrated at 3/4 rather than 4/4.",
        "Check that the customer migration example maps to the role's agency bar.",
        "Assign a reviewer before moving the candidate forward.",
      ],
    },
    artifactChecklist: availableArtifacts,
    transcriptPreview: [
      {
        timestamp: "00:02:11",
        speaker: "Interviewer",
        question: "Warmup",
        quote: "I am going to ask for specific examples and then follow up on tradeoffs.",
      },
      {
        timestamp: "00:04:18",
        speaker: "Candidate",
        question: "Production root-cause story",
        quote:
          "The symptom looked like a payment retry issue, but the duplicate charge only happened when the webhook arrived before our local write completed.",
      },
      {
        timestamp: "00:12:09",
        speaker: "Candidate",
        question: "Product tradeoff over code elegance",
        quote:
          "We removed two configuration branches because onboarding was failing when users had to choose.",
      },
    ],
    timeline: [
      {
        at: "2026-05-31T18:15:00.000Z",
        label: "Invite opened",
        detail: "Candidate opened the expiring invite link.",
        severity: "info",
      },
      {
        at: "2026-05-31T18:16:00.000Z",
        label: "Consent accepted",
        detail: "Disclosure, recording, and transcript consent were accepted.",
        severity: "success",
      },
      {
        at: "2026-05-31T18:32:00.000Z",
        label: "Recording complete",
        detail: "LiveKit egress produced video and audio assets.",
        severity: "success",
      },
      {
        at: "2026-05-31T18:35:00.000Z",
        label: "Review packet ready",
        detail: "Assessment, transcript, artifacts, and audit events are attached.",
        severity: "success",
      },
    ],
  },
  {
    id: "sess-nolan-2026-05-31",
    roleId: "founding-fullstack-engineer",
    candidateId: "nolan-patel",
    lifecycleStatus: "Review ready",
    inviteState: "Joined",
    consentState: "Accepted",
    roomName: "puddle-fs-nolan-1aa9",
    recordingState: "Available",
    scheduledAt: "2026-05-31T15:50:00.000Z",
    startedAt: "2026-05-31T15:56:00.000Z",
    endedAt: "2026-05-31T16:09:00.000Z",
    durationMinutes: 13,
    scriptVersion: "founding-fs-v3.2",
    media: {
      videoStatus: "Available",
      audioStatus: "Available",
      transcriptStatus: "Available",
      durationLabel: "13:14",
      playbackPositionLabel: "06:52",
      note: "Review should inspect one integrity marker and below-bar score evidence.",
    },
    markers: nolanMarkers,
    transcript: nolanTranscript,
    reviewSummary: {
      owner: "Jordan Kim",
      dueAt: "2026-06-01T18:00:00.000Z",
      recommendationRationale:
        "Hold recommendation reflects mixed agency evidence, weak product judgment, and one authenticity signal that needs inspection.",
      reviewFocus: [
        "Listen to the specificity drop after the metric follow-up at 00:06:52.",
        "Decide whether problem solving should remain below bar or move to at bar.",
        "Add a reviewer note before final decision because this packet is already in review.",
      ],
    },
    artifactChecklist: availableArtifacts,
    transcriptPreview: [
      {
        timestamp: "00:03:55",
        speaker: "Candidate",
        question: "Production root-cause story",
        quote:
          "We had a caching layer that was not invalidating, and I coordinated the fix with the API team and support.",
      },
      {
        timestamp: "00:09:21",
        speaker: "Candidate",
        question: "Product tradeoff over code elegance",
        quote:
          "I would probably still choose the cleaner abstraction, but I understand there are times when speed is more important.",
      },
    ],
    timeline: [
      {
        at: "2026-05-31T15:50:00.000Z",
        label: "Invite opened",
        detail: "Candidate opened the link twice before joining.",
        severity: "info",
      },
      {
        at: "2026-05-31T15:55:00.000Z",
        label: "Consent accepted",
        detail: "Disclosure, recording, and transcript consent were accepted.",
        severity: "success",
      },
      {
        at: "2026-05-31T16:08:00.000Z",
        label: "Integrity signal",
        detail: "Two longer pauses were flagged for reviewer inspection.",
        severity: "warning",
      },
      {
        at: "2026-05-31T16:10:00.000Z",
        label: "Review packet ready",
        detail: "Scorecard is ready with one integrity item.",
        severity: "success",
      },
    ],
  },
  {
    id: "sess-elena-2026-05-30",
    roleId: "founding-fullstack-engineer",
    candidateId: "elena-garcia",
    lifecycleStatus: "Review ready",
    inviteState: "Joined",
    consentState: "Accepted",
    roomName: "puddle-fs-elena-2c81",
    recordingState: "Available",
    scheduledAt: "2026-05-30T20:50:00.000Z",
    startedAt: "2026-05-30T20:56:00.000Z",
    endedAt: "2026-05-30T21:10:00.000Z",
    durationMinutes: 14,
    scriptVersion: "founding-fs-v3.2",
    media: {
      videoStatus: "Available",
      audioStatus: "Available",
      transcriptStatus: "Available",
      durationLabel: "14:08",
      playbackPositionLabel: "05:04",
      note: "Reviewed packet remains available for calibration and audit.",
    },
    markers: elenaMarkers,
    transcript: elenaTranscript,
    reviewSummary: {
      owner: "Anika Rao",
      dueAt: "2026-05-31T18:00:00.000Z",
      recommendationRationale:
        "Advance decision was signed off after strong systems framing, agency evidence, and low integrity risk.",
      reviewFocus: ["Use as a calibration example for above-bar founding engineer problem solving."],
    },
    artifactChecklist: availableArtifacts,
    transcriptPreview: [
      {
        timestamp: "00:05:04",
        speaker: "Candidate",
        question: "Production root-cause story",
        quote:
          "The key was accepting that the failure was in our mental model of the queue, not in the queue itself.",
      },
    ],
    timeline: [
      {
        at: "2026-05-30T20:55:00.000Z",
        label: "Consent accepted",
        detail: "Candidate accepted recording and transcript disclosure.",
        severity: "success",
      },
      {
        at: "2026-05-30T21:12:00.000Z",
        label: "Reviewer advanced",
        detail: "Anika Rao marked the packet reviewed and advanced the candidate.",
        severity: "success",
      },
    ],
  },
  {
    id: "sess-tariq-2026-06-02",
    roleId: "founding-fullstack-engineer",
    candidateId: "tariq-owens",
    lifecycleStatus: "Scheduled",
    inviteState: "Opened",
    consentState: "Not requested",
    roomName: "puddle-fs-tariq-7df0",
    recordingState: "Not started",
    scheduledAt: "2026-06-02T17:00:00.000Z",
    startedAt: null,
    endedAt: null,
    durationMinutes: null,
    scriptVersion: "founding-fs-v3.2",
    media: missingMedia,
    markers: [],
    transcript: [],
    reviewSummary: emptyReviewSummary,
    artifactChecklist: [],
    transcriptPreview: [],
    timeline: [
      {
        at: "2026-05-31T13:30:00.000Z",
        label: "Invite sent",
        detail: "Candidate invite was created and emailed.",
        severity: "info",
      },
      {
        at: "2026-05-31T14:04:00.000Z",
        label: "Invite opened",
        detail: "Candidate viewed the interview instructions.",
        severity: "info",
      },
    ],
  },
  {
    id: "sess-zoe-2026-06-01",
    roleId: "founding-fullstack-engineer",
    candidateId: "zoe-kim",
    lifecycleStatus: "In progress",
    inviteState: "Joined",
    consentState: "Accepted",
    roomName: "puddle-fs-zoe-51ed",
    recordingState: "Recording",
    scheduledAt: "2026-06-01T15:00:00.000Z",
    startedAt: "2026-06-01T15:08:00.000Z",
    endedAt: null,
    durationMinutes: null,
    scriptVersion: "founding-fs-v3.2",
    media: liveMedia,
    markers: [],
    transcript: [],
    reviewSummary: {
      owner: "Unassigned",
      dueAt: "2026-06-02T18:00:00.000Z",
      recommendationRationale: "Interview is live. Recommendation will appear after recording, transcript, and scorecard processing.",
      reviewFocus: ["Monitor the room only if a live operations issue appears."],
    },
    artifactChecklist: [],
    transcriptPreview: [],
    timeline: [
      {
        at: "2026-06-01T15:08:00.000Z",
        label: "Room joined",
        detail: "Candidate and interviewer agent are in the room.",
        severity: "success",
      },
      {
        at: "2026-06-01T15:09:00.000Z",
        label: "Recording started",
        detail: "LiveKit egress is recording the session.",
        severity: "success",
      },
    ],
  },
  {
    id: "sess-emma-2026-05-31",
    roleId: "ai-infra-engineer",
    candidateId: "emma-wilson",
    lifecycleStatus: "Review ready",
    inviteState: "Joined",
    consentState: "Accepted",
    roomName: "puddle-ai-emma-3d45",
    recordingState: "Available",
    scheduledAt: "2026-05-31T20:20:00.000Z",
    startedAt: "2026-05-31T20:27:00.000Z",
    endedAt: "2026-05-31T20:43:00.000Z",
    durationMinutes: 16,
    scriptVersion: "ai-infra-v2.7",
    media: {
      videoStatus: "Available",
      audioStatus: "Available",
      transcriptStatus: "Available",
      durationLabel: "16:21",
      playbackPositionLabel: "06:36",
      note: "AI infrastructure packet is ready with evidence markers for fallback design and eval discipline.",
    },
    markers: emmaMarkers,
    transcript: emmaTranscript,
    reviewSummary: {
      owner: "Unassigned",
      dueAt: "2026-06-01T22:30:00.000Z",
      recommendationRationale:
        "Advance recommendation is driven by model operations strength and practical distributed systems judgment.",
      reviewFocus: [
        "Confirm distributed systems stays at 3/4 rather than 4/4.",
        "Compare eval-gated rollout answer against the staff-level bar.",
        "Assign a reviewer before sending to the hiring manager.",
      ],
    },
    artifactChecklist: availableArtifacts,
    transcriptPreview: [
      {
        timestamp: "00:06:36",
        speaker: "Candidate",
        question: "Latency and provider failures",
        quote:
          "The fallback is not just another provider. It is a degraded product mode with a different latency promise.",
      },
    ],
    timeline: [
      {
        at: "2026-05-31T20:26:00.000Z",
        label: "Consent accepted",
        detail: "Disclosure and recording consent were accepted.",
        severity: "success",
      },
      {
        at: "2026-05-31T20:44:00.000Z",
        label: "Review packet ready",
        detail: "AI infrastructure scorecard is ready for review.",
        severity: "success",
      },
    ],
  },
  {
    id: "sess-samir-2026-06-01",
    roleId: "ai-infra-engineer",
    candidateId: "samir-lee",
    lifecycleStatus: "Recording finalizing",
    inviteState: "Joined",
    consentState: "Accepted",
    roomName: "puddle-ai-samir-6ba1",
    recordingState: "Finalizing",
    scheduledAt: "2026-06-01T15:20:00.000Z",
    startedAt: "2026-06-01T15:28:00.000Z",
    endedAt: "2026-06-01T15:43:00.000Z",
    durationMinutes: 15,
    scriptVersion: "ai-infra-v2.7",
    media: finalizingMedia,
    markers: [
      {
        timestamp: "00:15:22",
        label: "Recording finalizing",
        type: "Integrity",
        detail: "Audio/video copy is still running, so transcript evidence is unavailable.",
      },
    ],
    transcript: [],
    reviewSummary: {
      owner: "Unassigned",
      dueAt: "2026-06-02T20:00:00.000Z",
      recommendationRationale: "Recommendation is pending until transcript and scorecard artifacts finish processing.",
      reviewFocus: ["Reopen when recording copy and transcript post-processing complete."],
    },
    artifactChecklist: finalizingArtifacts,
    transcriptPreview: [],
    timeline: [
      {
        at: "2026-06-01T15:27:00.000Z",
        label: "Consent accepted",
        detail: "Candidate accepted recording and transcript disclosure.",
        severity: "success",
      },
      {
        at: "2026-06-01T15:43:00.000Z",
        label: "Recording finalizing",
        detail: "Video asset is being copied before transcript processing starts.",
        severity: "warning",
      },
    ],
  },
];

/**
 * Activity fixtures.
 * Source mapping:
 * - audit_log / events: reviewer actions, lifecycle changes, invite activity, integrity events.
 * - assessments: scorecard readiness and recommendation changes.
 * - recording_artifacts: recording and transcript processing state.
 */
export const demoActivity: readonly DemoActivity[] = [
  {
    id: "act-maya-ready",
    roleId: "founding-fullstack-engineer",
    candidateId: "maya-chen",
    sessionId: "sess-maya-2026-05-31",
    title: "Maya C. scorecard ready",
    detail: "Advance recommendation with 14/16 rubric score.",
    happenedAt: "2026-05-31T18:35:00.000Z",
    severity: "success",
  },
  {
    id: "act-samir-finalizing",
    roleId: "ai-infra-engineer",
    candidateId: "samir-lee",
    sessionId: "sess-samir-2026-06-01",
    title: "Recording finalizing",
    detail: "Samir L. recording is copying before transcript processing.",
    happenedAt: "2026-06-01T16:05:00.000Z",
    severity: "warning",
  },
  {
    id: "act-nolan-risk",
    roleId: "founding-fullstack-engineer",
    candidateId: "nolan-patel",
    sessionId: "sess-nolan-2026-05-31",
    title: "Integrity item added",
    detail: "One scripted-answer signal needs reviewer inspection.",
    happenedAt: "2026-05-31T16:10:00.000Z",
    severity: "warning",
  },
  {
    id: "act-emma-ready",
    roleId: "ai-infra-engineer",
    candidateId: "emma-wilson",
    sessionId: "sess-emma-2026-05-31",
    title: "Emma W. ready for review",
    detail: "AI infrastructure scorecard completed with low authenticity risk.",
    happenedAt: "2026-05-31T20:44:00.000Z",
    severity: "success",
  },
  {
    id: "act-elena-advanced",
    roleId: "founding-fullstack-engineer",
    candidateId: "elena-garcia",
    sessionId: "sess-elena-2026-05-30",
    title: "Elena G. advanced",
    detail: "Reviewer marked the packet reviewed and advanced the candidate.",
    happenedAt: "2026-05-30T21:12:00.000Z",
    severity: "success",
  },
  {
    id: "act-tariq-opened",
    roleId: "founding-fullstack-engineer",
    candidateId: "tariq-owens",
    sessionId: "sess-tariq-2026-06-02",
    title: "Invite opened",
    detail: "Tariq O. opened the candidate interview instructions.",
    happenedAt: "2026-05-31T14:04:00.000Z",
    severity: "info",
  },
];

export function getRole(roleId: string): DemoRole | undefined {
  return demoRoles.find((role) => role.id === roleId);
}

export function getCandidate(roleId: string, candidateId: string): DemoCandidate | undefined {
  return demoCandidates.find((candidate) => candidate.roleId === roleId && candidate.id === candidateId);
}

export function getCandidateById(candidateId: string): DemoCandidate | undefined {
  return demoCandidates.find((candidate) => candidate.id === candidateId);
}

export function getSession(sessionId: string): DemoSession | undefined {
  return demoSessions.find((session) => session.id === sessionId);
}

export function getCandidatesForRole(roleId: string): readonly DemoCandidate[] {
  return demoCandidates.filter((candidate) => candidate.roleId === roleId);
}

export function getSessionsForRole(roleId: string): readonly DemoSession[] {
  return demoSessions.filter((session) => session.roleId === roleId);
}

function artifactReadiness(session: DemoSession): string {
  if (!session.artifactChecklist.length) {
    return "Not ready";
  }

  const readyCount = session.artifactChecklist.filter((artifact) => artifact.status === "Available").length;
  return `${readyCount}/${session.artifactChecklist.length} ready`;
}

function reviewAgeHours(updatedAt: string): number {
  return Math.max(1, Math.round((DEMO_NOW.getTime() - new Date(updatedAt).getTime()) / 3_600_000));
}

export function getReviewPackets(): readonly ReviewPacket[] {
  return demoSessions
    .flatMap((session) => {
      if (session.lifecycleStatus !== "Review ready") {
        return [];
      }

      const candidate = getCandidateById(session.candidateId);
      const role = getRole(session.roleId);

      if (!candidate || !role || candidate.reviewStatus === "Reviewed") {
        return [];
      }

      const updatedAt = candidate.lastActivityAt;
      return [
        {
          session,
          candidate,
          role,
          updatedAt,
          packetAgeHours: reviewAgeHours(updatedAt),
          artifactReadiness: artifactReadiness(session),
        },
      ];
    })
    .sort((left, right) => {
      if (left.candidate.reviewer === "Unassigned" && right.candidate.reviewer !== "Unassigned") {
        return -1;
      }
      if (left.candidate.reviewer !== "Unassigned" && right.candidate.reviewer === "Unassigned") {
        return 1;
      }
      return right.packetAgeHours - left.packetAgeHours;
    });
}

export function getActiveInterviewSessions(): readonly DemoSession[] {
  return demoSessions
    .filter((session) => session.lifecycleStatus === "In progress" || session.lifecycleStatus === "Recording finalizing")
    .sort((left, right) => new Date(right.scheduledAt).getTime() - new Date(left.scheduledAt).getTime());
}

export function getReviewQueue(): readonly DemoCandidate[] {
  return demoCandidates
    .filter((candidate) => candidate.pipelineStatus === "Review ready" && candidate.reviewStatus !== "Reviewed")
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}

export function getActivityForRole(roleId: string): readonly DemoActivity[] {
  return demoActivity.filter((activity) => activity.roleId === roleId);
}

export function getDashboardStats() {
  const activeRoles = demoRoles.filter((role) => role.status === "Active").length;
  const screenedCandidates = demoCandidates.filter((candidate) => candidate.screenLengthMinutes !== null).length;
  const reviewPackets = getReviewPackets();
  const reviewReadySessions = reviewPackets.length;
  const unassignedReviews = reviewPackets.filter((packet) => packet.candidate.reviewer === "Unassigned").length;
  const oldestReviewHours = Math.max(...reviewPackets.map((packet) => packet.packetAgeHours), 0);
  const completedToday = demoSessions.filter((session) => session.endedAt?.startsWith(DEMO_TODAY)).length;
  const screenLengths = demoCandidates
    .map((candidate) => candidate.screenLengthMinutes)
    .filter((duration): duration is number => duration !== null);
  const avgScreenLength = Math.round(
    screenLengths.reduce((total, duration) => total + duration, 0) / Math.max(screenLengths.length, 1),
  );
  const flaggedIntegrityItems = demoCandidates.reduce((total, candidate) => total + candidate.integrityFlags, 0);

  return {
    activeRoles,
    screenedCandidates,
    reviewReadySessions,
    unassignedReviews,
    oldestReviewHours,
    completedToday,
    avgScreenLength,
    flaggedIntegrityItems,
  };
}
