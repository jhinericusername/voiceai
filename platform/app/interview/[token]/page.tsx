import { InterviewJoinClient } from "./InterviewJoinClient";

export const dynamic = "force-dynamic";

interface InterviewInvitePageProps {
  readonly params: Promise<{
    readonly token: string;
  }>;
}

export default async function InterviewInvitePage({ params }: InterviewInvitePageProps) {
  const { token } = await params;

  return (
    <main className="min-h-svh bg-[#f8fafd] p-3 text-[#202124] sm:p-4 lg:p-5">
      <div className="mx-auto max-w-[1600px]">
        <InterviewJoinClient token={token} />
      </div>
    </main>
  );
}
