import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { PublicPageShell } from "../../PublicPageShell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Security | Puddle",
  description: marketingPages.security.description,
};

export default function SecurityPage() {
  return <PublicPageShell page={marketingPages.security} />;
}
