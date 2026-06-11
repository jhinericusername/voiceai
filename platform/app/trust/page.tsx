import type { Metadata } from "next";
import { marketingPages } from "../marketingPages";
import { publicRouteSeo } from "../publicRoutes";
import { PublicPageStructuredData } from "../PublicPageStructuredData";
import { PublicPageShell } from "../PublicPageShell";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.trust;

export const metadata: Metadata = publicPageMetadata(route);

export default function TrustPage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Trust", path: "/trust" },
        ]}
      />
      <PublicPageShell page={marketingPages.trust} />
    </>
  );
}
