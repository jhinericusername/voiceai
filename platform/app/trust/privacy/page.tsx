import type { Metadata } from "next";
import { LegalPageShell } from "../../LegalPageShell";
import { privacyPage } from "../../legalPages";
import { publicRouteSeo } from "../../publicRoutes";
import { PublicPageStructuredData } from "../../PublicPageStructuredData";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.privacy;

export const metadata: Metadata = publicPageMetadata(route);

export default function PrivacyPage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Trust", path: "/trust" },
          { name: "Privacy", path: "/privacy" },
        ]}
      />
      <LegalPageShell page={privacyPage} />
    </>
  );
}
