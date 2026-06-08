import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { publicRouteSeo } from "../../publicRoutes";
import { PublicPageStructuredData } from "../../PublicPageStructuredData";
import { PublicPageShell } from "../../PublicPageShell";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.security;

export const metadata: Metadata = publicPageMetadata(route);

export default function SecurityPage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Trust", path: "/trust" },
          { name: "Security", path: "/trust/security" },
        ]}
      />
      <PublicPageShell page={marketingPages.security} />
    </>
  );
}
