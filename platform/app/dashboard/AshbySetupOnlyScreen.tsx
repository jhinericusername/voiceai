import Image from "next/image";
import type { AshbyCompanyState } from "@/lib/ashby/server";
import { AshbyOnboardingWizard } from "./AshbyOnboardingWizard";

export function AshbySetupOnlyScreen({
  state,
  canManageSetup,
}: {
  readonly state: AshbyCompanyState;
  readonly canManageSetup: boolean;
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
          <Image
            src="/puddle-mascot.svg"
            alt="Puddle turtle mascot"
            width={72}
            height={72}
            priority
            className="hidden h-16 w-16 shrink-0 sm:block"
          />
        </header>

        <AshbyOnboardingWizard state={state} canManageSetup={canManageSetup} />
      </div>
    </main>
  );
}
