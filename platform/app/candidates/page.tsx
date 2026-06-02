import type { Metadata } from "next";
import { marketingPages } from "../marketingPages";
import { PublicPageShell } from "../PublicPageShell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Candidates | Puddle",
  description: marketingPages.candidates.description,
};

export default function CandidatesPage() {
  return <PublicPageShell page={marketingPages.candidates} />;
}
