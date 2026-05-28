import Image from "next/image";
import Link from "next/link";
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
    <main className="min-h-svh bg-[#eef7ff] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between rounded-lg border border-white/70 bg-white/70 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur">
          <Link href="/" className="flex items-center gap-3" aria-label="Puddle home">
            <Image src="/puddle-symbol-black-nobg.png" alt="" width={42} height={42} className="h-10 w-10" />
            <div>
              <div className="text-lg font-semibold">Puddle</div>
              <div className="text-sm text-slate-500">Interview room</div>
            </div>
          </Link>
        </header>

        <InterviewJoinClient token={token} />
      </div>
    </main>
  );
}
