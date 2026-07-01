"use client";

import { type ReactNode, useRef } from "react";
import {
  EmptyState,
  SectionPanel,
  StatusPill,
  cx,
  formatDateTime,
} from "../../dashboard-ui";

type TranscriptTurn = {
  readonly turnIndex: number;
  readonly speaker: "agent" | "candidate";
  readonly text: string;
  readonly occurredAt: string;
  readonly offsetMs: number | null;
};

export function InterviewPlaybackReview({
  compositeVideoUrl,
  candidateAudioUrl,
  videoStatus,
  audioStatus,
  transcriptTurns,
  startedAt,
  children,
}: {
  readonly compositeVideoUrl: string | null;
  readonly candidateAudioUrl: string | null;
  readonly videoStatus: string;
  readonly audioStatus: string;
  readonly transcriptTurns: readonly TranscriptTurn[];
  readonly startedAt: string | null;
  readonly children: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playableMediaAvailable = Boolean(compositeVideoUrl || candidateAudioUrl);

  function seekToTurn(turn: TranscriptTurn) {
    const offsetSeconds = playbackOffsetSeconds(turn, startedAt);
    const media = compositeVideoUrl ? videoRef.current : audioRef.current;
    if (offsetSeconds === null || !media) {
      return;
    }

    media.currentTime = offsetSeconds;
    void media.play().catch(() => undefined);
    media.focus({ preventScroll: true });
  }

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
      <main className="grid min-w-0 gap-5">
        <SectionPanel
          title="Video and audio review"
          eyebrow="Recording"
          action={
            <div className="flex flex-wrap gap-2">
              <StatusPill status={videoStatus} />
              <StatusPill status={audioStatus} />
            </div>
          }
        >
          {compositeVideoUrl ? (
            <video
              ref={videoRef}
              className="aspect-video w-full rounded-md bg-slate-950"
              controls
              src={compositeVideoUrl}
            />
          ) : candidateAudioUrl ? (
            <div className="grid min-h-56 place-items-center rounded-md bg-slate-950 px-4 py-8">
              <div className="w-full max-w-xl">
                <div className="mb-4 text-center text-sm font-semibold text-white">Audio recording</div>
                <audio ref={audioRef} className="w-full" controls src={candidateAudioUrl} />
              </div>
            </div>
          ) : (
            <EmptyState title="Playable media unavailable" detail="The interview packet has no available playback URL yet." />
          )}
        </SectionPanel>

        {children}
      </main>

      <aside aria-label="Transcript" className="grid min-w-0 gap-5 xl:content-start">
        <SectionPanel title="Transcript" eyebrow="Evidence">
          {transcriptTurns.length ? (
            <div className="grid gap-3 xl:max-h-[calc(100svh-12rem)] xl:overflow-y-auto xl:pr-1">
              {transcriptTurns.map((turn) => {
                const timestampLabel = formatOffset(turn.offsetMs) ?? formatDateTime(turn.occurredAt);
                const offsetSeconds = playbackOffsetSeconds(turn, startedAt);
                const canSeek = playableMediaAvailable && offsetSeconds !== null;
                const transcriptTurnClassName = cx(
                  "w-full text-left rounded-md border px-3 py-3",
                  canSeek
                    ? "cursor-pointer transition hover:border-cyan-300 hover:bg-cyan-50 focus:outline-none focus:ring-4 focus:ring-cyan-100"
                    : "",
                  turn.speaker === "candidate" ? "border-cyan-200 bg-cyan-50/40" : "border-slate-200 bg-slate-50",
                );
                const transcriptTurnContent = (
                  <>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cx("font-mono text-xs font-semibold", canSeek ? "text-cyan-700" : "text-slate-500")}>
                        {canSeek ? <span className="sr-only">Jump playback to </span> : null}
                        {timestampLabel}
                      </span>
                      <StatusPill status={formatSpeaker(turn.speaker)} />
                    </span>
                    <span className="mt-2 block whitespace-pre-wrap text-sm leading-6 text-slate-700">{turn.text}</span>
                  </>
                );

                if (canSeek) {
                  return (
                    <button
                      key={`${turn.turnIndex}-${turn.speaker}-${turn.occurredAt}`}
                      type="button"
                      className={transcriptTurnClassName}
                      onClick={() => seekToTurn(turn)}
                    >
                      {transcriptTurnContent}
                    </button>
                  );
                }

                return (
                  <article key={`${turn.turnIndex}-${turn.speaker}-${turn.occurredAt}`} className={transcriptTurnClassName}>
                    {transcriptTurnContent}
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState title="Transcript unavailable" detail="Transcript turns appear here after recording finalization and post-processing complete." />
          )}
        </SectionPanel>
      </aside>
    </div>
  );
}

function playbackOffsetSeconds(turn: TranscriptTurn, startedAt: string | null): number | null {
  if (typeof turn.offsetMs === "number" && Number.isFinite(turn.offsetMs) && turn.offsetMs >= 0) {
    return turn.offsetMs / 1000;
  }

  if (!startedAt) {
    return null;
  }

  const startedMs = Date.parse(startedAt);
  const occurredMs = Date.parse(turn.occurredAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(occurredMs)) {
    return null;
  }

  return Math.max(0, (occurredMs - startedMs) / 1000);
}

function formatOffset(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatSpeaker(value: "agent" | "candidate"): string {
  return value === "agent" ? "Interviewer" : "Candidate";
}
