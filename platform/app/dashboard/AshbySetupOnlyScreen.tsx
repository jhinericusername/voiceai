import Image from "next/image";
import type { AshbyCompanyState } from "@/lib/ashby/server";
import { AshbyOnboardingWizard } from "./AshbyOnboardingWizard";
import { SectionPanel, secondaryButtonClass } from "./dashboard-ui";

export function AshbySetupOnlyScreen({
  state,
  canManageSetup,
  displayName,
  email,
}: {
  readonly state: AshbyCompanyState;
  readonly canManageSetup: boolean;
  readonly displayName: string;
  readonly email: string;
}) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex min-w-0 items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">
              Setup
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-950">Connect Ashby</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Finish Ashby setup before reviewing candidates, sending interviews, or opening imported recordings.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden min-w-0 text-right md:block">
              <div className="max-w-44 truncate text-sm font-semibold text-slate-950">{displayName}</div>
              <div className="max-w-44 truncate text-xs text-slate-500">{email}</div>
            </div>
            <a href="/logout" className={secondaryButtonClass}>
              Sign out
            </a>
            <Image
              src="/puddle-mascot.svg"
              alt="Puddle turtle mascot"
              width={72}
              height={72}
              priority
              className="hidden h-16 w-16 shrink-0 lg:block"
            />
          </div>
        </header>

        {canManageSetup ? (
          <AshbyOnboardingWizard state={state} canManageSetup={canManageSetup} />
        ) : (
          <SectionPanel title="Ashby setup is required" eyebrow="Workspace admin needed">
            <p className="text-sm leading-6 text-slate-600">
              Ask a workspace admin or owner to finish Ashby setup before this workspace can review candidates,
              send interviews, or open imported recordings.
            </p>
          </SectionPanel>
        )}
      </div>
    </main>
  );
}
