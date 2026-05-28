"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type RemoteTrack,
} from "livekit-client";

interface InterviewJoinClientProps {
  readonly token: string;
}

interface JoinResponse {
  readonly sessionId: string;
  readonly room: string;
  readonly liveKitUrl: string;
  readonly token: string;
}

type RoomStage = "intro" | "consent" | "preflight" | "connecting" | "live" | "complete";
type CheckStatus = "idle" | "checking" | "passed" | "failed";

interface ConsentState {
  readonly aiDisclosure: boolean;
  readonly recording: boolean;
  readonly dataUse: boolean;
}

const CONSENT_COPY = [
  "I understand this interview is conducted by an AI interviewer.",
  "I consent to audio and video processing for the interview session.",
  "I understand video is used for integrity signals, not scoring.",
] as const;

const STEPS: readonly { id: RoomStage; label: string }[] = [
  { id: "intro", label: "Invite" },
  { id: "consent", label: "Consent" },
  { id: "preflight", label: "Device check" },
  { id: "live", label: "Interview" },
];

export function InterviewJoinClient({ token }: InterviewJoinClientProps) {
  const [stage, setStage] = useState<RoomStage>("intro");
  const [consent, setConsent] = useState<ConsentState>({
    aiDisclosure: false,
    recording: false,
    dataUse: false,
  });
  const [preflightStatus, setPreflightStatus] = useState<CheckStatus>("idle");
  const [join, setJoin] = useState<JoinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [roomStatus, setRoomStatus] = useState("Not connected");
  const [remoteParticipants, setRemoteParticipants] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);

  const liveKitRoomRef = useRef<Room | null>(null);
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const localVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const callVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLDivElement | null>(null);

  const consentComplete = consent.aiDisclosure && consent.recording && consent.dataUse;
  const canEnterRoom = consentComplete && preflightStatus === "passed" && !isJoining;
  const elapsedLabel = useMemo(() => formatDuration(elapsedSeconds), [elapsedSeconds]);

  const stopPreview = useCallback((): void => {
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
  }, []);

  const cleanupRoom = useCallback((): void => {
    localAudioTrackRef.current?.stop();
    localAudioTrackRef.current = null;
    localVideoTrackRef.current?.stop();
    localVideoTrackRef.current = null;
    setLocalVideoTrack(null);
    liveKitRoomRef.current?.disconnect();
    liveKitRoomRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.replaceChildren();
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupRoom();
      stopPreview();
    };
  }, [cleanupRoom, stopPreview]);

  useEffect(() => {
    if (stage !== "live") {
      return;
    }

    const startedAt = Date.now();

    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [stage]);

  useEffect(() => {
    const video = callVideoRef.current;
    if (!video || !localVideoTrack || stage !== "live") {
      return;
    }

    localVideoTrack.attach(video);
    return () => {
      localVideoTrack.detach(video);
    };
  }, [localVideoTrack, stage]);

  async function runPreflight(): Promise<void> {
    setPreflightStatus("checking");
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setPreflightStatus("failed");
      setError("This browser cannot access camera and microphone devices.");
      return;
    }

    try {
      stopPreview();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: "user",
        },
      });
      previewStreamRef.current = stream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
      }
      setPreflightStatus("passed");
    } catch {
      setPreflightStatus("failed");
      setError("Camera or microphone access was blocked. Allow access and run the check again.");
    }
  }

  async function enterRoom(): Promise<void> {
    if (!canEnterRoom) {
      return;
    }

    setIsJoining(true);
    setError(null);
    setStage("connecting");
    setRoomStatus("Requesting room credentials");

    try {
      const response = await fetch(`/api/interviews/${encodeURIComponent(token)}/join`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setStage("preflight");
        setError(payload.error ?? "Could not join this interview.");
        return;
      }

      const credentials = payload as JoinResponse;
      setJoin(credentials);
      setRoomStatus("Connecting to room");

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      liveKitRoomRef.current = room;

      const updateParticipants = () => setRemoteParticipants(room.remoteParticipants.size);
      room.on(RoomEvent.Connected, () => setRoomStatus("Connected"));
      room.on(RoomEvent.Disconnected, () => setRoomStatus("Disconnected"));
      room.on(RoomEvent.ParticipantConnected, updateParticipants);
      room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
      room.on(RoomEvent.TrackSubscribed, attachRemoteTrack);
      room.on(RoomEvent.TrackUnsubscribed, detachRemoteTrack);

      await room.connect(credentials.liveKitUrl, credentials.token);
      updateParticipants();

      stopPreview();
      const [audioTrack, videoTrack] = await Promise.all([
        createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }),
        createLocalVideoTrack({
          facingMode: "user",
        }),
      ]);

      localAudioTrackRef.current = audioTrack;
      localVideoTrackRef.current = videoTrack;
      setLocalVideoTrack(videoTrack);
      await Promise.all([
        room.localParticipant.publishTrack(audioTrack),
        room.localParticipant.publishTrack(videoTrack),
      ]);

      setElapsedSeconds(0);
      setRoomStatus("Connected");
      setStage("live");
    } catch {
      cleanupRoom();
      setStage("preflight");
      setRoomStatus("Not connected");
      setError("The live room could not be opened. Refresh and try again.");
    } finally {
      setIsJoining(false);
    }
  }

  function attachRemoteTrack(track: RemoteTrack): void {
    if (track.kind !== Track.Kind.Audio || !remoteAudioRef.current) {
      return;
    }
    const element = track.attach();
    element.autoplay = true;
    element.dataset.puddleRemoteAudio = "true";
    remoteAudioRef.current.appendChild(element);
  }

  function detachRemoteTrack(track: RemoteTrack): void {
    for (const element of track.detach()) {
      element.remove();
    }
  }

  function endInterview(): void {
    cleanupRoom();
    setRoomStatus("Disconnected");
    setStage("complete");
  }

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Room flow</div>
        <ol className="mt-4 grid gap-3">
          {STEPS.map((step, index) => (
            <li key={step.id} className="flex items-center gap-3 text-sm">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
                  isStepActive(stage, step.id)
                    ? "border-slate-950 bg-slate-950 text-white"
                    : isStepComplete(stage, step.id)
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                {index + 1}
              </span>
              <span className={isStepActive(stage, step.id) ? "font-semibold text-slate-950" : "text-slate-600"}>
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      </aside>

      <section className="min-h-[620px] rounded-lg border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
        {stage === "intro" ? (
          <IntroPanel onContinue={() => setStage("consent")} />
        ) : null}

        {stage === "consent" ? (
          <ConsentPanel
            consent={consent}
            onChange={setConsent}
            onBack={() => setStage("intro")}
            onContinue={() => setStage("preflight")}
          />
        ) : null}

        {stage === "preflight" ? (
          <PreflightPanel
            status={preflightStatus}
            error={error}
            previewVideoRef={previewVideoRef}
            canEnterRoom={canEnterRoom}
            isJoining={isJoining}
            onBack={() => setStage("consent")}
            onRunPreflight={runPreflight}
            onEnterRoom={enterRoom}
          />
        ) : null}

        {stage === "connecting" ? (
          <ConnectingPanel roomStatus={roomStatus} />
        ) : null}

        {stage === "live" ? (
          <LivePanel
            join={join}
            roomStatus={roomStatus}
            elapsedLabel={elapsedLabel}
            remoteParticipants={remoteParticipants}
            callVideoRef={callVideoRef}
            remoteAudioRef={remoteAudioRef}
            onEnd={endInterview}
          />
        ) : null}

        {stage === "complete" ? <CompletePanel /> : null}
      </section>
    </div>
  );
}

function IntroPanel({ onContinue }: { readonly onContinue: () => void }) {
  return (
    <div className="grid min-h-[620px] content-center gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Candidate invite</div>
        <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-slate-950 md:text-5xl">
          Your Puddle interview is ready.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
          You will confirm consent, check your devices, and enter a live voice interview room.
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="mt-7 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold !text-white transition hover:bg-slate-800"
        >
          Continue
        </button>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="text-sm font-semibold text-slate-950">Before you join</div>
        <dl className="mt-4 grid gap-3 text-sm">
          <InfoRow label="Estimated time" value="30 minutes" />
          <InfoRow label="Devices" value="Camera and microphone" />
          <InfoRow label="Environment" value="Quiet space" />
        </dl>
      </div>
    </div>
  );
}

function ConsentPanel({
  consent,
  onChange,
  onBack,
  onContinue,
}: {
  readonly consent: ConsentState;
  readonly onChange: (consent: ConsentState) => void;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}) {
  const complete = consent.aiDisclosure && consent.recording && consent.dataUse;

  return (
    <div className="p-5 sm:p-8">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Consent</div>
      <h2 className="mt-3 text-2xl font-semibold text-slate-950 sm:text-3xl">Before we begin</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        Puddle uses a live AI interviewer and records the session so the hiring team can review the interview.
      </p>

      <div className="mt-6 grid gap-3">
        <ConsentCheck
          checked={consent.aiDisclosure}
          label={CONSENT_COPY[0]}
          onChange={(checked) => onChange({ ...consent, aiDisclosure: checked })}
        />
        <ConsentCheck
          checked={consent.recording}
          label={CONSENT_COPY[1]}
          onChange={(checked) => onChange({ ...consent, recording: checked })}
        />
        <ConsentCheck
          checked={consent.dataUse}
          label={CONSENT_COPY[2]}
          onChange={(checked) => onChange({ ...consent, dataUse: checked })}
        />
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!complete}
          className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold !text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function PreflightPanel({
  status,
  error,
  previewVideoRef,
  canEnterRoom,
  isJoining,
  onBack,
  onRunPreflight,
  onEnterRoom,
}: {
  readonly status: CheckStatus;
  readonly error: string | null;
  readonly previewVideoRef: RefObject<HTMLVideoElement | null>;
  readonly canEnterRoom: boolean;
  readonly isJoining: boolean;
  readonly onBack: () => void;
  readonly onRunPreflight: () => void;
  readonly onEnterRoom: () => void;
}) {
  return (
    <div className="grid min-h-[620px] gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Device check</div>
        <h2 className="mt-3 text-2xl font-semibold text-slate-950 sm:text-3xl">Check camera and microphone.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Your browser will ask for device access before the room opens.
        </p>

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
          <video
            ref={previewVideoRef}
            aria-label="Camera preview"
            autoPlay
            muted
            playsInline
            className="aspect-video w-full bg-slate-950 object-cover"
          />
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onRunPreflight}
            disabled={status === "checking"}
            className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            {status === "checking" ? "Checking..." : "Run device check"}
          </button>
          <button
            type="button"
            onClick={onEnterRoom}
            disabled={!canEnterRoom}
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold !text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isJoining ? "Opening room..." : "Enter room"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="text-sm font-semibold text-slate-950">Preflight status</div>
        <div className="mt-4 grid gap-3 text-sm">
          <StatusLine label="Camera" status={status} />
          <StatusLine label="Microphone" status={status} />
          <StatusLine label="Room token" status={canEnterRoom ? "passed" : "idle"} />
        </div>
      </div>
    </div>
  );
}

function ConnectingPanel({ roomStatus }: { readonly roomStatus: string }) {
  return (
    <div className="grid min-h-[620px] place-items-center p-8 text-center">
      <div>
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-slate-950" />
        <h2 className="mt-5 text-2xl font-semibold text-slate-950">Opening your room</h2>
        <p className="mt-2 text-sm text-slate-600">{roomStatus}</p>
      </div>
    </div>
  );
}

function LivePanel({
  join,
  roomStatus,
  elapsedLabel,
  remoteParticipants,
  callVideoRef,
  remoteAudioRef,
  onEnd,
}: {
  readonly join: JoinResponse | null;
  readonly roomStatus: string;
  readonly elapsedLabel: string;
  readonly remoteParticipants: number;
  readonly callVideoRef: RefObject<HTMLVideoElement | null>;
  readonly remoteAudioRef: RefObject<HTMLDivElement | null>;
  readonly onEnd: () => void;
}) {
  return (
    <div className="grid min-h-[620px] gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
          <div>
            <div className="text-sm font-semibold">Live interview</div>
            <div className="text-xs text-slate-300">{join?.room ?? "Room"}</div>
          </div>
          <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-100">
            {roomStatus}
          </div>
        </div>
        <div className="grid min-h-[430px] content-between gap-4 p-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="grid min-h-[280px] place-items-center rounded-lg border border-white/10 bg-slate-900 text-center text-white">
              <div>
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-sky-400 text-2xl font-semibold text-slate-950">
                  P
                </div>
                <div className="mt-4 text-lg font-semibold">Puddle interviewer</div>
                <div className="mt-1 text-sm text-slate-300">
                  {remoteParticipants > 0 ? "Connected to the room" : "Waiting for interviewer audio"}
                </div>
              </div>
            </div>
            <video
              ref={callVideoRef}
              aria-label="Self view"
              autoPlay
              muted
              playsInline
              className="aspect-video w-full rounded-lg border border-white/10 bg-slate-900 object-cover md:aspect-auto md:h-full"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100">
            <div>Elapsed {elapsedLabel}</div>
            <div>{remoteParticipants} remote participant{remoteParticipants === 1 ? "" : "s"}</div>
          </div>
        </div>
        <div ref={remoteAudioRef} aria-hidden="true" />
      </div>

      <aside className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="text-sm font-semibold text-slate-950">Session</div>
        <dl className="mt-4 grid gap-3 text-sm">
          <InfoRow label="Session" value={join?.sessionId ?? "-"} />
          <InfoRow label="Room" value={join?.room ?? "-"} />
          <InfoRow label="Status" value={roomStatus} />
        </dl>
        <button
          type="button"
          onClick={onEnd}
          className="mt-6 w-full rounded-full border border-rose-200 bg-white px-5 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
        >
          End interview
        </button>
      </aside>
    </div>
  );
}

function CompletePanel() {
  return (
    <div className="grid min-h-[620px] place-items-center p-8 text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-2xl text-emerald-700">
          ✓
        </div>
        <h2 className="mt-5 text-3xl font-semibold text-slate-950">Thank you.</h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
          Your interview is complete. You may close this page.
        </p>
      </div>
    </div>
  );
}

function ConsentCheck({
  checked,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-950"
      />
      <span>{label}</span>
    </label>
  );
}

function StatusLine({ label, status }: { readonly label: string; readonly status: CheckStatus }) {
  const copy =
    status === "passed"
      ? "Ready"
      : status === "checking"
        ? "Checking"
        : status === "failed"
          ? "Needs attention"
          : "Pending";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
      <span className="text-slate-600">{label}</span>
      <span className={status === "passed" ? "font-semibold text-emerald-700" : "font-semibold text-slate-500"}>
        {copy}
      </span>
    </div>
  );
}

function InfoRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-slate-700">{value}</dd>
    </div>
  );
}

function isStepActive(current: RoomStage, step: RoomStage): boolean {
  if (current === "connecting" && step === "preflight") {
    return true;
  }
  return current === step;
}

function isStepComplete(current: RoomStage, step: RoomStage): boolean {
  return stepOrder(current) > stepOrder(step);
}

function stepOrder(stage: RoomStage): number {
  if (stage === "connecting") {
    return stepOrder("preflight");
  }
  if (stage === "complete") {
    return STEPS.length;
  }
  return Math.max(
    0,
    STEPS.findIndex((step) => step.id === stage),
  );
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
