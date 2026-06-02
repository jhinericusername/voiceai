import type { Metadata } from "next";
import { LegalPageShell } from "../LegalPageShell";
import { subprocessorsPage } from "../legalPages";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Subprocessors | Puddle",
  description: subprocessorsPage.description,
};

export default function SubprocessorsPage() {
  return <LegalPageShell page={subprocessorsPage} />;
}
