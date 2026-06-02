import type { PublicPageContent } from "./PublicPageShell";

export const productRelated = [
  { label: "Rubric", href: "/product/rubric" },
  { label: "AI recruiter", href: "/product/sourcing" },
  { label: "Video interviews", href: "/product/video-interviews" },
] as const;

export const trustRelated = [
  { label: "Security", href: "/trust/security" },
  { label: "Privacy", href: "/privacy" },
  { label: "Subprocessors", href: "/subprocessors" },
  { label: "Responsible AI", href: "/trust/responsible-ai" },
  { label: "Candidate experience", href: "/trust/candidate-experience" },
] as const;

export const marketingPages = {
  product: {
    eyebrow: "Product",
    title: "A complete first-pass hiring system for AI engineers.",
    description:
      "Puddle turns your engineering team's standards into a rubric, sources and screens candidates against real work, runs fast video interviews, and packages the evidence for human review.",
    metric: "Rubric -> report",
    metricLabel: "Enterprise workflow",
    points: [
      "Define the role-specific bar with your own engineers before screening starts.",
      "Rank candidates using GitHub work, hackathon performance, peer recommendations, and role fit.",
      "Run 10-minute AI video interviews that ask direct, granular questions.",
      "Package recordings, transcripts, summaries, and rubric evidence for human review.",
    ],
    sections: [
      {
        title: "Rubric first",
        body: "The hiring process starts with what your team values, not a generic resume screen.",
      },
      {
        title: "Automated first pass",
        body: "Puddle handles the repetitive sourcing, screening, and interview work before your team spends time live.",
      },
      {
        title: "Reviewable output",
        body: "Every candidate packet is designed to show recordings, transcripts, summaries, and rubric evidence.",
      },
    ],
    related: productRelated,
  },
  sampleReport: {
    eyebrow: "Sample report",
    title: "Show hiring teams the interview record, not just a score.",
    description:
      "The sample report page will preview the candidate review packet Puddle returns after sourcing, screening, and video interviews.",
    metric: "1 packet",
    metricLabel: "What the report includes",
    points: [
      "Candidate profile with source signals and role fit.",
      "Rubric dimensions with transcript support behind each recommendation.",
      "Video recording summary and transcript excerpts from the 10-minute screen.",
      "Reviewer-ready notes tied to the team's role-specific hiring bar.",
    ],
    sections: [
      {
        title: "Recommendation",
        body: "A clear meet or pass recommendation with the reasoning behind it.",
      },
      {
        title: "Evidence trail",
        body: "The report should expose the transcript, summary, work signals, and rubric notes used to support the recommendation.",
      },
      {
        title: "Reviewer handoff",
        body: "The goal is to help humans decide who is worth meeting in person, not to hide decisions behind a black box.",
      },
    ],
    related: [
      { label: "Product", href: "/product" },
      { label: "Trust", href: "/trust" },
      { label: "Candidates", href: "/candidates" },
    ],
  },
  candidates: {
    eyebrow: "Candidates",
    title: "A candidate-facing explanation of the Puddle interview.",
    description:
      "This page will explain what Puddle is, why the company is using an AI interviewer, what is recorded, how long it takes, and what happens after the interview.",
    metric: "10 min",
    metricLabel: "Candidate expectations",
    points: [
      "Candidates understand that the interview is conducted by an AI interviewer.",
      "The page explains recording, transcript, and review use in plain language.",
      "Candidates know how to prepare for a direct, fast-paced video screen.",
      "The experience stays calm and transparent before they grant device access.",
    ],
    sections: [
      {
        title: "What to expect",
        body: "A short walkthrough of consent, device check, the live video interview, and post-interview review.",
      },
      {
        title: "How to prepare",
        body: "Candidates should be ready to discuss concrete projects, trade-offs, collaboration, and how they use AI tools.",
      },
      {
        title: "What is reviewed",
        body: "Hiring teams review answers, transcript, summaries, and evidence tied to the role rubric.",
      },
    ],
    related: [
      { label: "Trust", href: "/trust" },
      { label: "Candidate experience", href: "/trust/candidate-experience" },
      { label: "Privacy", href: "/privacy" },
    ],
  },
  trust: {
    eyebrow: "Trust",
    title: "Enterprise-grade clarity for AI-assisted hiring.",
    description:
      "The trust section will explain Puddle's security posture, privacy model, responsible AI boundaries, recording use, human review, and auditability.",
    metric: "Audit-ready",
    metricLabel: "Trust surface area",
    points: [
      "Security controls for sensitive recruiting and candidate data.",
      "Privacy explanations for recordings, transcripts, retention, and deletion.",
      "Responsible AI boundaries around scoring, recommendations, and human review.",
      "Candidate-facing transparency before video and microphone access.",
    ],
    sections: [
      {
        title: "Security",
        body: "Describe authentication, access control, encryption, audit logs, and enterprise readiness as the platform matures.",
      },
      {
        title: "Privacy",
        body: "Explain data collection, candidate recordings, transcript handling, retention, and deletion workflows.",
      },
      {
        title: "Responsible AI",
        body: "Make clear where AI assists, where humans review, and how decisions remain inspectable.",
      },
    ],
    related: trustRelated,
  },
  rubric: {
    eyebrow: "Product / Rubric",
    title: "Replace resume-first screening with a company-specific bar.",
    description:
      "Puddle works with your team to define the dimensions that matter for a role, then turns each dimension into above-bar, at-bar, and below-bar evidence.",
    metric: "Step 1",
    metricLabel: "Rubric design",
    points: [
      "Define dimensions like collaboration, determination, technical skill, and AI fluency.",
      "Translate each dimension into observable evidence.",
      "Use the rubric across sourcing, screening, interviews, and build evaluation.",
      "Keep hiring managers aligned before candidates enter the process.",
    ],
    sections: [
      {
        title: "Role-specific",
        body: "The rubric is built around one team's needs instead of a universal engineering test.",
      },
      {
        title: "Evidence-based",
        body: "Puddle ties each dimension to candidate work, interview answers, and build behavior.",
      },
      {
        title: "Reusable",
        body: "The same bar can be applied consistently across large candidate pools.",
      },
    ],
    related: productRelated,
  },
  sourcing: {
    eyebrow: "Product / AI recruiter",
    title: "Source and screen candidates beyond the resume.",
    description:
      "The AI recruiter ranks candidates using rubric criteria, GitHub repos, hackathon performance, peer recommendations, and role fit.",
    metric: "Step 2",
    metricLabel: "Candidate discovery",
    points: [
      "Look past pedigree and resume polish.",
      "Pull in work signals that better reflect AI-era engineering.",
      "Prioritize candidates before human interview time is spent.",
      "Feed the video interviewer with role and candidate context.",
    ],
    sections: [
      {
        title: "Work signal",
        body: "GitHub and project history help identify candidates who have actually built things.",
      },
      {
        title: "Peer signal",
        body: "Recommendations and community context can support the rubric when available.",
      },
      {
        title: "Ranked pipeline",
        body: "The output is a prioritized list of candidates for fast video screening.",
      },
    ],
    related: productRelated,
  },
  videoInterviews: {
    eyebrow: "Product / Video interviews",
    title: "Run 10-minute video screens with direct, granular questions.",
    description:
      "Puddle's interviewer agent screens promising candidates quickly, records each interview, and returns transcript, summary, and evidence for review.",
    metric: "10 min",
    metricLabel: "Interview format",
    points: [
      "Fast-paced questions reduce room for rehearsed answers.",
      "The interviewer follows the role rubric and candidate context.",
      "Every recording and transcript is available to the hiring team.",
      "Human reviewers inspect the evidence before deciding who to meet.",
    ],
    sections: [
      {
        title: "Direct questions",
        body: "The interview asks specific questions about projects, decisions, trade-offs, and collaboration.",
      },
      {
        title: "Recorded evidence",
        body: "Teams can watch, read, and compare candidates without relying on a one-line summary.",
      },
      {
        title: "High throughput",
        body: "Hundreds of candidates can be screened before your team spends in-person interview time.",
      },
    ],
    related: productRelated,
  },
  security: {
    eyebrow: "Trust / Security",
    title: "Security posture for sensitive candidate data.",
    description:
      "This page will document how Puddle protects recruiting data, recordings, transcripts, candidate signals, and reviewer access.",
    metric: "Enterprise",
    metricLabel: "Security controls",
    points: [
      "Authentication and role-based access for staff workflows.",
      "Separation between candidate invite access and customer workspace access.",
      "Auditability for review packets and hiring materials.",
      "Planned enterprise controls such as SSO, permissions, and audit logs.",
    ],
    sections: [
      {
        title: "Access control",
        body: "Explain who can view candidate materials and how staff accounts are controlled.",
      },
      {
        title: "Data protection",
        body: "Describe storage, encryption, retention, and deletion posture as controls are finalized.",
      },
      {
        title: "Operational readiness",
        body: "Use this page to answer security review questions before procurement asks.",
      },
    ],
    related: trustRelated,
  },
  privacy: {
    eyebrow: "Trust / Privacy",
    title: "Plain-language privacy for candidates and hiring teams.",
    description:
      "This page will explain what data Puddle collects, why recordings and transcripts exist, how long data is retained, and how deletion works.",
    metric: "Candidate data",
    metricLabel: "Privacy model",
    points: [
      "Candidates see AI interviewer and recording disclosures before joining.",
      "Recordings and transcripts support hiring-team review.",
      "Video should be explained as interview evidence and integrity context.",
      "Customers need clear retention and deletion expectations.",
    ],
    sections: [
      {
        title: "Disclosure",
        body: "Make the candidate experience explicit before microphone and camera access.",
      },
      {
        title: "Use limitation",
        body: "Explain how interview data supports hiring review and where AI recommendations fit.",
      },
      {
        title: "Retention",
        body: "Document how long evidence is kept and what deletion controls customers can request.",
      },
    ],
    related: trustRelated,
  },
  responsibleAi: {
    eyebrow: "Trust / Responsible AI",
    title: "Bounded AI assistance with human-reviewable evidence.",
    description:
      "Puddle should make clear what the AI recruiter and interviewer do, what they do not decide alone, and how teams inspect the evidence.",
    metric: "Human review",
    metricLabel: "AI boundaries",
    points: [
      "AI helps source, screen, interview, summarize, and organize evidence.",
      "The process is anchored to the customer's role-specific rubric.",
      "Recommendations should be inspectable through recordings, transcripts, and source signals.",
      "Human teams decide who advances to in-person interviews.",
    ],
    sections: [
      {
        title: "Bounded agents",
        body: "Agents should operate inside role, rubric, and interview policy constraints.",
      },
      {
        title: "Inspectable evidence",
        body: "Every recommendation needs a trail a hiring team can read, watch, and challenge.",
      },
      {
        title: "Human decision",
        body: "Puddle automates first-pass work so humans can focus on the most promising candidates.",
      },
    ],
    related: trustRelated,
  },
  candidateExperience: {
    eyebrow: "Trust / Candidate experience",
    title: "A transparent AI interview flow for candidates.",
    description:
      "This page will show the candidate journey from invite to consent, device check, AI video screen, and post-interview review.",
    metric: "10 min",
    metricLabel: "Candidate flow",
    points: [
      "Candidates understand they are speaking with an AI interviewer.",
      "The interview is short, direct, and role-specific.",
      "Candidates know what is recorded and why.",
      "The process explains what happens after the interview.",
    ],
    sections: [
      {
        title: "Before the interview",
        body: "Explain the invite, disclosure, consent, and camera/microphone preflight.",
      },
      {
        title: "During the interview",
        body: "Set expectations for a fast-paced, 10-minute video conversation.",
      },
      {
        title: "After the interview",
        body: "Explain how the hiring team reviews recording, transcript, summary, and rubric evidence.",
      },
    ],
    related: trustRelated,
  },
} satisfies Record<string, PublicPageContent>;
