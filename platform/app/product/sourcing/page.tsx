import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { PublicPageShell } from "../../PublicPageShell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "AI Recruiter | Puddle",
  description: marketingPages.sourcing.description,
};

export default function SourcingPage() {
  return <PublicPageShell page={marketingPages.sourcing} />;
}
