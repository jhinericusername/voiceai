import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { PublicPageShell } from "../../PublicPageShell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Candidate Experience | Puddle",
  description: marketingPages.candidateExperience.description,
};

export default function CandidateExperiencePage() {
  return <PublicPageShell page={marketingPages.candidateExperience} />;
}
