import type { Metadata } from "next";
import { LegalPageShell } from "../LegalPageShell";
import { aiInterviewDisclosurePage } from "../legalPages";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "AI Interview Disclosure | Puddle",
  description: aiInterviewDisclosurePage.description,
};

export default function AiInterviewDisclosurePage() {
  return <LegalPageShell page={aiInterviewDisclosurePage} />;
}
