import type { Metadata } from "next";
import { marketingPages } from "../../marketingPages";
import { PublicPageShell } from "../../PublicPageShell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Video Interviews | Puddle",
  description: marketingPages.videoInterviews.description,
};

export default function VideoInterviewsPage() {
  return <PublicPageShell page={marketingPages.videoInterviews} />;
}
