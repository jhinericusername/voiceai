import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo";
import { InterviewJoinClient } from "./InterviewJoinClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = noindexMetadata;

interface InterviewInvitePageProps {
  readonly params: Promise<{
    readonly token: string;
  }>;
}

export default async function InterviewInvitePage({ params }: InterviewInvitePageProps) {
  const { token } = await params;

  return (
    <main className="min-h-svh bg-[#f8fafd] p-3 text-[#202124] sm:p-4 lg:p-5">
      <div className="mx-auto max-w-[1180px]">
        <InterviewJoinClient token={token} />
      </div>
    </main>
  );
}
