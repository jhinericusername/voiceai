import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { publicRouteSeo } from "../../publicRoutes";
import { PublicPageStructuredData } from "../../PublicPageStructuredData";
import { PublicPageShell } from "../../PublicPageShell";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.rubric;

export const metadata: Metadata = publicPageMetadata(route);

export default function RubricPage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        kind="softwareApplication"
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Product", path: "/product" },
          { name: "Role-specific rubric", path: "/product/rubric" },
        ]}
      />
      <PublicPageShell page={marketingPages.rubric} />
    </>
  );
}
