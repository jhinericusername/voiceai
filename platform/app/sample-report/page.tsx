import type { Metadata } from "next";
import { PublicFooter } from "../PublicFooter";
import { PublicNav } from "../PublicNav";
import { SampleReportClient } from "./SampleReportClient";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sample Report | Puddle",
  description:
    "Inspect a sample Puddle candidate review packet with rubric notes, coverage, authenticity signals, and a final recommendation.",
};

export default function SampleReportPage() {
  return (
    <main className="puddle-page min-h-svh text-slate-950">
      <PublicNav />
      <SampleReportClient />
      <PublicFooter className="py-8" />
    </main>
  );
}
