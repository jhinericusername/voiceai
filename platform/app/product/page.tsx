import type { Metadata } from "next";
import { marketingPages } from "../marketingPages";
import { publicRouteSeo } from "../publicRoutes";
import { PublicPageStructuredData } from "../PublicPageStructuredData";
import { PublicPageShell } from "../PublicPageShell";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.product;

export const metadata: Metadata = publicPageMetadata(route);

export default function ProductPage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        kind="softwareApplication"
        name="Puddle technical hiring infrastructure"
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Product", path: "/product" },
        ]}
      />
      <PublicPageShell page={marketingPages.product} />
    </>
  );
}
