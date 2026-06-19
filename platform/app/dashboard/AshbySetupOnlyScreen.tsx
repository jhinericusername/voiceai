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
    <main className="puddle-dashboard-shell min-h-screen px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="puddle-setup-hero flex min-w-0 items-center justify-between gap-4 px-4 py-4 sm:px-5 sm:py-5">
          <div className="relative z-10 min-w-0">
            <p className="puddle-hero-kicker inline-flex rounded-md border border-cyan-200 bg-cyan-50/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-800">
              Setup
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950 sm:text-3xl">Connect Ashby</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Finish Ashby setup before reviewing candidates, sending interviews, or opening imported recordings.
            </p>
          </div>
          <div className="relative z-10 flex shrink-0 items-center gap-3">
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
              className="puddle-mascot-float hidden h-20 w-20 shrink-0 lg:block"
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
