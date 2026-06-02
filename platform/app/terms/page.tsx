import type { Metadata } from "next";
import { LegalPageShell } from "../LegalPageShell";
import { termsPage } from "../legalPages";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Terms | Puddle",
  description: termsPage.description,
};

export default function TermsPage() {
  return <LegalPageShell page={termsPage} />;
}
