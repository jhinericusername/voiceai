import type { Metadata } from "next";
import { LegalPageShell } from "../LegalPageShell";
import { aiInterviewDisclosurePage } from "../legalPages";
import { publicRouteSeo } from "../publicRoutes";
import { PublicPageStructuredData } from "../PublicPageStructuredData";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.aiInterviewDisclosure;

export const metadata: Metadata = publicPageMetadata(route);

export default function AiInterviewDisclosurePage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "AI interview disclosure", path: "/ai-interview-disclosure" },
        ]}
      />
      <LegalPageShell page={aiInterviewDisclosurePage} />
    </>
  );
}
