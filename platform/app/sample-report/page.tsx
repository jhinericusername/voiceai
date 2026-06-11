import type { Metadata } from "next";
import { PublicFooter } from "../PublicFooter";
import { PublicNav } from "../PublicNav";
import { publicRouteSeo } from "../publicRoutes";
import { PublicPageStructuredData } from "../PublicPageStructuredData";
import { SampleReportClient } from "./SampleReportClient";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.sampleReport;

export const metadata: Metadata = publicPageMetadata(route);

export default function SampleReportPage() {
  return (
    <main className="puddle-page min-h-svh text-slate-950">
      <PublicPageStructuredData
        route={route}
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Sample report", path: "/sample-report" },
        ]}
      />
      <PublicNav />
      <SampleReportClient />
      <PublicFooter className="py-8" />
    </main>
  );
}
