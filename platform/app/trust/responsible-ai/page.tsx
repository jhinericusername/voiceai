import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { PublicPageShell } from "../../PublicPageShell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Responsible AI | Puddle",
  description: marketingPages.responsibleAi.description,
};

export default function ResponsibleAiPage() {
  return <PublicPageShell page={marketingPages.responsibleAi} />;
}
