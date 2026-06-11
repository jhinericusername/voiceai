import type { Metadata } from "next";
import { LegalPageShell } from "../LegalPageShell";
import { termsPage } from "../legalPages";
import { publicRouteSeo } from "../publicRoutes";
import { PublicPageStructuredData } from "../PublicPageStructuredData";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.terms;

export const metadata: Metadata = publicPageMetadata(route);

export default function TermsPage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Terms", path: "/terms" },
        ]}
      />
      <LegalPageShell page={termsPage} />
    </>
  );
}
