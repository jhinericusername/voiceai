import type { Metadata } from "next";
import { marketingPages } from "../marketingPages";
import { PublicPageShell } from "../PublicPageShell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Trust | Puddle",
  description: marketingPages.trust.description,
};

export default function TrustPage() {
  return <PublicPageShell page={marketingPages.trust} />;
}
