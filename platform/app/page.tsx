import type { Metadata } from "next";
import { JsonLd } from "./JsonLd";
import HomeClient from "./HomeClient";
import { publicRouteSeo } from "./publicRoutes";
import { publicPageMetadata, websiteJsonLd } from "@/lib/seo";

export const dynamic = "force-static";

export const metadata: Metadata = publicPageMetadata(publicRouteSeo.home);

export default function Page() {
  return (
    <>
      <JsonLd data={websiteJsonLd()} />
      <HomeClient />
    </>
  );
}
