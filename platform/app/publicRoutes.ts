import { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from "@/lib/seo";
import { marketingPages } from "./marketingPages";
import { aiInterviewDisclosurePage, privacyPage, subprocessorsPage, termsPage } from "./legalPages";

export interface PublicRouteSeo {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly changeFrequency: "weekly" | "monthly" | "yearly";
  readonly priority: number;
}

export const publicRouteSeo = {
  home: {
    path: "/",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    changeFrequency: "weekly",
    priority: 1,
  },
  product: {
    path: "/product",
    title: "Product | Puddle",
    description: marketingPages.product.description,
    changeFrequency: "monthly",
    priority: 0.9,
  },
  rubric: {
    path: "/product/rubric",
    title: "Role-Specific Rubric | Puddle",
    description: marketingPages.rubric.description,
    changeFrequency: "monthly",
    priority: 0.82,
  },
  sourcing: {
    path: "/product/sourcing",
    title: "AI Recruiter | Puddle",
    description: marketingPages.sourcing.description,
    changeFrequency: "monthly",
    priority: 0.82,
  },
  videoInterviews: {
    path: "/product/video-interviews",
    title: "Video Interviews | Puddle",
    description: marketingPages.videoInterviews.description,
    changeFrequency: "monthly",
    priority: 0.84,
  },
  sampleReport: {
    path: "/sample-report",
    title: "Sample Report | Puddle",
    description:
      "Inspect a sample Puddle candidate review packet with rubric notes, coverage, authenticity signals, and a final recommendation.",
    changeFrequency: "monthly",
    priority: 0.78,
  },
  candidates: {
    path: "/candidates",
    title: "Candidates | Puddle",
    description: marketingPages.candidates.description,
    changeFrequency: "monthly",
    priority: 0.78,
  },
  trust: {
    path: "/trust",
    title: "Trust | Puddle",
    description: marketingPages.trust.description,
    changeFrequency: "monthly",
    priority: 0.78,
  },
  security: {
    path: "/trust/security",
    title: "Security | Puddle",
    description: marketingPages.security.description,
    changeFrequency: "monthly",
    priority: 0.72,
  },
  responsibleAi: {
    path: "/trust/responsible-ai",
    title: "Responsible AI | Puddle",
    description: marketingPages.responsibleAi.description,
    changeFrequency: "monthly",
    priority: 0.74,
  },
  candidateExperience: {
    path: "/trust/candidate-experience",
    title: "Candidate Experience | Puddle",
    description: marketingPages.candidateExperience.description,
    changeFrequency: "monthly",
    priority: 0.74,
  },
  privacy: {
    path: "/privacy",
    title: "Privacy | Puddle",
    description: privacyPage.description,
    changeFrequency: "yearly",
    priority: 0.45,
  },
  terms: {
    path: "/terms",
    title: "Terms | Puddle",
    description: termsPage.description,
    changeFrequency: "yearly",
    priority: 0.4,
  },
  aiInterviewDisclosure: {
    path: "/ai-interview-disclosure",
    title: "AI Interview Disclosure | Puddle",
    description: aiInterviewDisclosurePage.description,
    changeFrequency: "yearly",
    priority: 0.5,
  },
  subprocessors: {
    path: "/subprocessors",
    title: "Subprocessors | Puddle",
    description: subprocessorsPage.description,
    changeFrequency: "yearly",
    priority: 0.38,
  },
  resources: {
    path: "/resources",
    title: "Resources | Puddle",
    description:
      "Practical guides to structured AI video interviews, engineering hiring rubrics, candidate experience, and reviewer-ready evidence packets.",
    changeFrequency: "weekly",
    priority: 0.72,
  },
} satisfies Record<string, PublicRouteSeo>;

export const sitemapPublicRoutes = Object.values(publicRouteSeo);
