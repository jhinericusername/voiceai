import Link from "next/link";
import { notFound } from "next/navigation";
import { demoSessions, getCandidateById, getRole, getSession } from "../../demo-data";
import {
  EmptyState,
  SectionPanel,
  StatusPill,
  formatDateTime,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../dashboard-ui";

export function generateStaticParams() {
  return demoSessions.map((session) => ({ sessionId: session.id }));
}

export default async function InterviewSessionPage({ params }: { readonly params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = getSession(sessionId);

  if (!session) {
    notFound();
  }

  const candidate = getCandidateById(session.candidateId);
  const role = getRole(session.roleId);

  if (!candidate || !role) {
    notFound();
  }

  return (
    <div className="mx-auto grid min-w-0 max-w-[1440px] gap-5">
      <header className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={session.lifecycleStatus} />
              <StatusPill status={session.recordingState} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Interview session</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{candidate.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Did the interview and artifacts complete correctly? Inspect lifecycle, consent, recording, transcript, and audit events for {role.title}.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {candidate.scorecard.length ? (
              <Link href={`/dashboard/roles/${role.id}/candidates/${candidate.id}`} className={primaryButtonClass}>
                Open report
              </Link>
            ) : null}
            <Link href={`/dashboard/roles/${role.id}`} className={secondaryButtonClass}>
              Back to role
            </Link>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Lifecycle</div>
          <div className="mt-2">
            <StatusPill status={session.lifecycleStatus} />
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Invite</div>
          <div className="mt-2">
            <StatusPill status={session.inviteState} />
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Consent</div>
          <div className="mt-2">
            <StatusPill status={session.consentState} />
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Recording</div>
          <div className="mt-2">
            <StatusPill status={session.recordingState} />
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Duration</div>
          <div className="mt-2 text-xl font-semibold text-slate-950">
            {session.durationMinutes ? `${session.durationMinutes}m` : "Pending"}
          </div>
        </div>
      </section>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="grid min-w-0 gap-5">
          <SectionPanel title="Session details" eyebrow="Room state">
            <div className="grid gap-3 md:grid-cols-2">
              <DetailRow label="Room name" value={session.roomName} mono />
              <DetailRow label="Script version" value={session.scriptVersion} />
              <DetailRow label="Scheduled" value={formatDateTime(session.scheduledAt)} />
              <DetailRow label="Started" value={session.startedAt ? formatDateTime(session.startedAt) : "Not started"} />
              <DetailRow label="Ended" value={session.endedAt ? formatDateTime(session.endedAt) : "Not ended"} />
              <DetailRow label="Candidate email" value={candidate.email} />
            </div>
          </SectionPanel>

          <SectionPanel title="Artifact checklist" eyebrow="Completion">
            {session.artifactChecklist.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {session.artifactChecklist.map((artifact) => (
                  <div key={artifact.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium text-slate-950">{artifact.label}</div>
                      <StatusPill status={artifact.status} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{artifact.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Artifacts not created yet"
                detail="Recording, transcript, scorecard, and integrity artifacts appear here as the session moves through the lifecycle."
              />
            )}
          </SectionPanel>

          <SectionPanel title="Transcript preview" eyebrow="Excerpt">
            {session.transcriptPreview.length ? (
              <div className="grid gap-3">
                {session.transcriptPreview.map((excerpt) => (
                  <div key={`${excerpt.timestamp}-${excerpt.question}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-500">{excerpt.timestamp}</span>
                      <StatusPill status={excerpt.speaker} />
                    </div>
                    <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{excerpt.question}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">&quot;{excerpt.quote}&quot;</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Transcript preview unavailable" detail="Transcript excerpts appear after recording finalization and transcription complete." />
            )}
          </SectionPanel>
        </main>

        <aside className="grid min-w-0 gap-5 xl:content-start">
          <SectionPanel title="Candidate packet" eyebrow="Links">
            <div className="grid gap-3 text-sm">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Candidate</div>
                <div className="mt-1 font-semibold text-slate-950">{candidate.name}</div>
                <div className="mt-1 text-slate-500">{candidate.email}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Role</div>
                <Link href={`/dashboard/roles/${role.id}`} className="mt-1 block font-semibold text-cyan-700 hover:text-cyan-900">
                  {role.title}
                </Link>
              </div>
              {candidate.scorecard.length ? (
                <Link href={`/dashboard/roles/${role.id}/candidates/${candidate.id}`} className={primaryButtonClass}>
                  Review scorecard
                </Link>
              ) : (
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                  Scorecard will unlock after artifacts finish.
                </div>
              )}
            </div>
          </SectionPanel>

          <SectionPanel title="Audit timeline" eyebrow="Events">
            <div className="grid gap-3">
              {session.timeline.map((event) => (
                <div key={`${event.at}-${event.label}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-950">{event.label}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(event.at)}</div>
                    </div>
                    <StatusPill status={event.severity === "warning" ? "In review" : "Available"} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{event.detail}</p>
                </div>
              ))}
            </div>
          </SectionPanel>
        </aside>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-1 break-words text-sm font-medium text-slate-950 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
