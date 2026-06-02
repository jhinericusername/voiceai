import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { PublicPageShell } from "../../PublicPageShell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Role-Specific Rubric | Puddle",
  description: marketingPages.rubric.description,
};

export default function RubricPage() {
  return <PublicPageShell page={marketingPages.rubric} />;
}
