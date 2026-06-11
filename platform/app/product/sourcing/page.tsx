import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { publicRouteSeo } from "../../publicRoutes";
import { PublicPageStructuredData } from "../../PublicPageStructuredData";
import { PublicPageShell } from "../../PublicPageShell";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.sourcing;

export const metadata: Metadata = publicPageMetadata(route);

export default function SourcingPage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        kind="softwareApplication"
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Product", path: "/product" },
          { name: "AI recruiter", path: "/product/sourcing" },
        ]}
      />
      <PublicPageShell page={marketingPages.sourcing} />
    </>
  );
}
