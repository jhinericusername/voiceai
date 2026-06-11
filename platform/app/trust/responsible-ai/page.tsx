import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { publicRouteSeo } from "../../publicRoutes";
import { PublicPageStructuredData } from "../../PublicPageStructuredData";
import { PublicPageShell } from "../../PublicPageShell";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.responsibleAi;

export const metadata: Metadata = publicPageMetadata(route);

export default function ResponsibleAiPage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Trust", path: "/trust" },
          { name: "Responsible AI", path: "/trust/responsible-ai" },
        ]}
      />
      <PublicPageShell page={marketingPages.responsibleAi} />
    </>
  );
}
