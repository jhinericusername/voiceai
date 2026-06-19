import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo";
import { requireDashboardUser } from "../../../auth";
import { InterviewerJoinClient } from "./InterviewerJoinClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = noindexMetadata;

interface InterviewerJoinPageProps {
  readonly params: Promise<{
    readonly sessionId: string;
  }>;
}

export default async function InterviewerJoinPage({ params }: InterviewerJoinPageProps) {
  const { sessionId } = await params;

  await requireDashboardUser(`/dashboard/interviews/${encodeURIComponent(sessionId)}/join`);

  return (
    <main className="fixed inset-0 z-[100] overflow-auto bg-[#f8fafd] text-[#202124]">
      <InterviewerJoinClient sessionId={sessionId} />
    </main>
  );
}
