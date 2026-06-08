export interface ResourceLink {
  readonly label: string;
  readonly href: string;
}

export interface ResourceSection {
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly bullets?: readonly string[];
  readonly example?: {
    readonly title: string;
    readonly items: readonly string[];
  };
}

export interface ResourcePage {
  readonly slug: string;
  readonly title: string;
  readonly question: string;
  readonly description: string;
  readonly byline: string;
  readonly publishedAt: string;
  readonly updatedAt?: string;
  readonly displayDate: string;
  readonly summary: string;
  readonly sections: readonly ResourceSection[];
  readonly related: readonly ResourceLink[];
}

const publishedAt = "2026-06-03";
const displayDate = "June 3, 2026";
const byline = "Puddle team";

export const resourcePages: readonly ResourcePage[] = [
  {
    slug: "ai-video-interviews-engineering-hiring",
    title: "How should AI video interviews work for engineering hiring?",
    question: "What makes an AI video interview useful for engineering hiring instead of just faster screening?",
    description:
      "A practical guide to using structured AI video interviews for engineering roles, with rubric alignment, recording review, and human decision-making.",
    byline,
    publishedAt,
    displayDate,
    summary:
      "AI video interviews are most useful when they create comparable, reviewable evidence for a hiring team. They should not be treated as a black-box replacement for human interviewers or as a generic personality screen.",
    sections: [
      {
        heading: "Start with the job evidence, not the interview bot",
        paragraphs: [
          "A good engineering screen begins with the team's hiring bar. The AI interviewer should ask questions that map back to role-specific evidence: systems judgment, project ownership, debugging behavior, collaboration, and how the candidate uses AI tools in real work.",
          "The interview should be short enough to respect the candidate's time, but structured enough that reviewers can compare candidates against the same standard.",
        ],
      },
      {
        heading: "Make the output reviewable",
        paragraphs: [
          "The value of an AI video interview is the record it creates: recording, transcript, summary, rubric notes, and clear timestamps. Reviewers should be able to inspect why a candidate was recommended instead of accepting an unexplained score.",
        ],
        example: {
          title: "A reviewable packet should include",
          items: [
            "The question asked and the candidate's answer in transcript form.",
            "A timestamped recording segment for answers that affect the recommendation.",
            "Rubric notes that separate strong evidence from weak or missing evidence.",
            "A recommendation that states uncertainty and what a human interviewer should verify next.",
          ],
        },
      },
      {
        heading: "Keep humans in the hiring decision",
        paragraphs: [
          "AI-assisted screening can reduce repetitive first-pass work, but the hiring company should still decide who advances. The system should make recommendations easier to audit, challenge, and calibrate.",
        ],
      },
    ],
    related: [
      { label: "Video interviews", href: "/product/video-interviews" },
      { label: "Responsible AI", href: "/trust/responsible-ai" },
      { label: "Sample report", href: "/sample-report" },
    ],
  },
  {
    slug: "evaluate-technical-candidates-consistently",
    title: "How can teams evaluate technical candidates consistently?",
    question: "How do you keep technical candidate evaluation consistent across a high-volume hiring process?",
    description:
      "A guide to consistent technical candidate evaluation using shared rubrics, structured evidence, calibrated reviewers, and comparable interview packets.",
    byline,
    publishedAt,
    displayDate,
    summary:
      "Consistency comes from making the hiring bar explicit, collecting the same categories of evidence, and asking reviewers to explain decisions against observable signals.",
    sections: [
      {
        heading: "Define the dimensions before candidates enter the funnel",
        paragraphs: [
          "Teams often drift when each reviewer privately decides what matters. A better process names the dimensions in advance and gives reviewers examples of above-bar, at-bar, and below-bar evidence.",
          "For engineering roles, the dimensions usually need to reflect the actual job: technical depth, product judgment, collaboration, persistence, communication, and AI fluency where relevant.",
        ],
      },
      {
        heading: "Collect comparable evidence",
        paragraphs: [
          "A resume, a GitHub profile, and an interview answer are not interchangeable. They should be organized as different evidence types that support or weaken a rubric dimension.",
        ],
        bullets: [
          "Source evidence explains why the candidate entered the funnel.",
          "Interview evidence captures how the candidate explains decisions and trade-offs.",
          "Work evidence shows what the candidate has built or maintained.",
          "Reviewer notes document what humans still need to verify.",
        ],
      },
      {
        heading: "Calibrate with examples",
        paragraphs: [
          "Consistency improves when reviewers can see examples of evidence, not only scores. A packet that includes transcript excerpts and timestamps gives the team something concrete to discuss when calibrating the bar.",
        ],
      },
    ],
    related: [
      { label: "Role-specific rubric", href: "/product/rubric" },
      { label: "Sample report", href: "/sample-report" },
      { label: "Product overview", href: "/product" },
    ],
  },
  {
    slug: "structured-interview-rubrics",
    title: "What belongs in a structured interview rubric?",
    question: "What should a structured interview rubric include for engineering hiring?",
    description:
      "A practical breakdown of structured interview rubric design for technical hiring, including dimensions, evidence examples, and reviewer calibration.",
    byline,
    publishedAt,
    displayDate,
    summary:
      "A structured interview rubric should define the dimensions that matter for the role, describe observable evidence for each level, and connect interview questions to the same bar.",
    sections: [
      {
        heading: "Use dimensions that match the job",
        paragraphs: [
          "A rubric should not be a generic list of traits. For an AI engineer, the rubric might include technical depth, ability to ship with ambiguity, model and tool judgment, collaboration, and determination under debugging pressure.",
        ],
      },
      {
        heading: "Write evidence, not adjectives",
        paragraphs: [
          "Words like strong, smart, or senior are too vague to score consistently. Each dimension needs observable evidence that a reviewer can find in a project history, interview transcript, or work sample.",
        ],
        example: {
          title: "Example rubric language",
          items: [
            "Above bar: explains a trade-off they owned, why alternatives were rejected, and what changed after deployment.",
            "At bar: describes the implementation clearly but gives limited detail on trade-offs or impact.",
            "Below bar: gives broad claims without concrete decisions, constraints, or examples.",
          ],
        },
      },
      {
        heading: "Tie questions back to the rubric",
        paragraphs: [
          "Each interview question should exist because it can produce evidence for a dimension. If a question does not help reviewers make a fairer decision, remove it.",
        ],
      },
    ],
    related: [
      { label: "Rubric product page", href: "/product/rubric" },
      { label: "Responsible AI", href: "/trust/responsible-ai" },
      { label: "Evidence packets", href: "/resources/interview-evidence-packets-reviewer-calibration" },
    ],
  },
  {
    slug: "candidate-experience-ai-interviews",
    title: "What is a good candidate experience for AI interviews?",
    question: "How should companies explain and run an AI interview so candidates understand the process?",
    description:
      "Guidance for candidate-facing AI interview experiences, including disclosure, consent, recording expectations, preparation, and post-interview review.",
    byline,
    publishedAt,
    displayDate,
    summary:
      "A good candidate experience is transparent before the interview starts. Candidates should know they are speaking with an AI interviewer, what is recorded, how long it takes, and who reviews the result.",
    sections: [
      {
        heading: "Disclose the AI interviewer clearly",
        paragraphs: [
          "Candidates should not discover the nature of the interview after granting camera and microphone access. The invite and preflight screen should explain that the interviewer is AI-assisted and that the hiring team will review the record.",
        ],
      },
      {
        heading: "Explain what is recorded and why",
        paragraphs: [
          "Recording and transcription can improve review quality, but candidates deserve plain-language expectations. The product should explain that recordings, transcripts, summaries, and rubric notes support human review.",
        ],
        bullets: [
          "State the expected interview length.",
          "Explain microphone and camera use before requesting permissions.",
          "Tell candidates what happens after the interview.",
          "Provide a contact path for accommodations or alternative processes.",
        ],
      },
      {
        heading: "Ask job-related questions",
        paragraphs: [
          "Candidate trust depends on relevance. The AI interviewer should ask about concrete projects, decisions, trade-offs, and collaboration instead of appearance, emotion, accent, or other non-job-related traits.",
        ],
      },
    ],
    related: [
      { label: "Candidate page", href: "/candidates" },
      { label: "Candidate experience", href: "/trust/candidate-experience" },
      { label: "AI interview disclosure", href: "/ai-interview-disclosure" },
    ],
  },
  {
    slug: "interview-evidence-packets-reviewer-calibration",
    title: "How do interview evidence packets improve reviewer calibration?",
    question: "Why should hiring teams review evidence packets instead of only interview scores?",
    description:
      "How structured candidate evidence packets help reviewers calibrate recommendations, compare candidates, and audit AI-assisted hiring workflows.",
    byline,
    publishedAt,
    displayDate,
    summary:
      "Evidence packets make candidate review more inspectable. They connect recommendations to source signals, interview transcripts, recording timestamps, rubric notes, and open questions for human reviewers.",
    sections: [
      {
        heading: "Scores need context",
        paragraphs: [
          "A score can help triage, but it is not enough for calibration. Reviewers need to know what evidence produced the recommendation and where the system is uncertain.",
        ],
      },
      {
        heading: "Packets create a shared review object",
        paragraphs: [
          "When every reviewer sees the same packet, calibration conversations become more concrete. The team can discuss a transcript excerpt, timestamp, or source signal instead of debating impressions from memory.",
        ],
        example: {
          title: "Useful packet fields",
          items: [
            "Recommendation and confidence with caveats.",
            "Rubric dimension notes with transcript support.",
            "Recording timestamps for important answers.",
            "Source signals such as project history, referrals, or public work.",
            "Follow-up questions for a human interviewer.",
          ],
        },
      },
      {
        heading: "Calibration should be continuous",
        paragraphs: [
          "The best hiring systems use review outcomes to refine the rubric. If reviewers repeatedly override recommendations for the same reason, the team should update the rubric, interview prompts, or evidence thresholds.",
        ],
      },
    ],
    related: [
      { label: "Sample report", href: "/sample-report" },
      { label: "Evaluate candidates consistently", href: "/resources/evaluate-technical-candidates-consistently" },
      { label: "Security", href: "/trust/security" },
    ],
  },
];

export function getResourcePage(slug: string): ResourcePage | undefined {
  return resourcePages.find((resource) => resource.slug === slug);
}
