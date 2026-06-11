import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { publicRouteSeo } from "../../publicRoutes";
import { PublicPageStructuredData } from "../../PublicPageStructuredData";
import { PublicPageShell } from "../../PublicPageShell";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.videoInterviews;

export const metadata: Metadata = publicPageMetadata(route);

export default function VideoInterviewsPage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        kind="softwareApplication"
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Product", path: "/product" },
          { name: "Video interviews", path: "/product/video-interviews" },
        ]}
      />
      <PublicPageShell page={marketingPages.videoInterviews} />
    </>
  );
}
