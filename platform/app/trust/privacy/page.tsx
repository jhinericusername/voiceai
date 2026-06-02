import type { Metadata } from "next";
import { LegalPageShell } from "../../LegalPageShell";
import { privacyPage } from "../../legalPages";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy | Puddle",
  description: privacyPage.description,
};

export default function PrivacyPage() {
  return <LegalPageShell page={privacyPage} />;
}
