"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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

type RoomStage = "intro" | "consent" | "preflight" | "waiting" | "connecting" | "live" | "complete";
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
  { id: "waiting", label: "Waiting room" },
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
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [isPreviewMicEnabled, setIsPreviewMicEnabled] = useState(true);
  const [isPreviewCameraEnabled, setIsPreviewCameraEnabled] = useState(true);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);

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
    setPreviewStream(null);
    setIsPreviewMicEnabled(true);
    setIsPreviewCameraEnabled(true);
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
    setIsMicEnabled(true);
    setIsCameraEnabled(true);
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

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !previewStream || (stage !== "preflight" && stage !== "waiting")) {
      return;
    }

    video.srcObject = previewStream;
    return () => {
      if (video.srcObject === previewStream) {
        video.srcObject = null;
      }
    };
  }, [previewStream, stage]);

  const togglePreviewMic = useCallback((): void => {
    setIsPreviewMicEnabled((current) => {
      const next = !current;
      previewStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = next;
      });
      return next;
    });
  }, []);

  const togglePreviewCamera = useCallback((): void => {
    setIsPreviewCameraEnabled((current) => {
      const next = !current;
      previewStreamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = next;
      });
      return next;
    });
  }, []);

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
      setPreviewStream(stream);
      setIsPreviewMicEnabled(true);
      setIsPreviewCameraEnabled(true);
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
      const publishAudioEnabled = isPreviewMicEnabled;
      const publishVideoEnabled = isPreviewCameraEnabled;
      const response = await fetch(`/api/interviews/${encodeURIComponent(token)}/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          consent: {
            aiDisclosureAcknowledged: consent.aiDisclosure,
            recordingConsented: consent.recording,
            dataUseAcknowledged: consent.dataUse,
            consentedAt: new Date().toISOString(),
          },
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setStage("waiting");
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
      await Promise.all([
        setLocalTrackEnabled(audioTrack, publishAudioEnabled),
        setLocalTrackEnabled(videoTrack, publishVideoEnabled),
      ]);
      setLocalVideoTrack(videoTrack);
      setIsMicEnabled(publishAudioEnabled);
      setIsCameraEnabled(publishVideoEnabled);
      await Promise.all([
        room.localParticipant.publishTrack(audioTrack),
        room.localParticipant.publishTrack(videoTrack),
      ]);

      setElapsedSeconds(0);
      setRoomStatus("Connected");
      setStage("live");
    } catch {
      cleanupRoom();
      setStage("waiting");
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
    void element.play().catch(() => {
      setError("Interviewer audio was blocked by the browser. Click Leave, then rejoin the interview.");
    });
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
    <section
      className={`mt-6 min-h-[620px] overflow-hidden rounded-lg shadow-[0_22px_70px_rgba(15,23,42,0.14)] ${
        stage === "live" || stage === "connecting" ? "bg-slate-950" : "border border-slate-200 bg-white"
      }`}
    >
      {stage !== "live" && stage !== "connecting" ? (
        <header className="border-b border-slate-200 bg-white/90 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-950">Puddle interview room</div>
              <div className="mt-1 text-sm text-slate-500">Candidate waiting room</div>
            </div>
            <StepPills current={stage} />
          </div>
        </header>
      ) : null}

        <div ref={remoteAudioRef} aria-hidden="true" className="fixed h-0 w-0 overflow-hidden" />

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
            onEnterWaitingRoom={() => setStage("waiting")}
          />
        ) : null}

        {stage === "waiting" ? (
          <WaitingPanel
            error={error}
            previewVideoRef={previewVideoRef}
            isJoining={isJoining}
            roomStatus={roomStatus}
            isMicEnabled={isPreviewMicEnabled}
            isCameraEnabled={isPreviewCameraEnabled}
            onToggleMic={togglePreviewMic}
            onToggleCamera={togglePreviewCamera}
            onBack={() => setStage("preflight")}
            onJoin={enterRoom}
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
            isMicEnabled={isMicEnabled}
            isCameraEnabled={isCameraEnabled}
            onToggleMic={() => {
              const next = !isMicEnabled;
              void setLocalTrackEnabled(localAudioTrackRef.current, next);
              setIsMicEnabled(next);
            }}
            onToggleCamera={() => {
              const next = !isCameraEnabled;
              void setLocalTrackEnabled(localVideoTrackRef.current, next);
              setIsCameraEnabled(next);
            }}
            onEnd={endInterview}
          />
        ) : null}

        {stage === "complete" ? <CompletePanel /> : null}
    </section>
  );
}

function IntroPanel({ onContinue }: { readonly onContinue: () => void }) {
  return (
    <div className="grid min-h-[620px] gap-6 bg-[#f8fbff] p-5 sm:p-6 lg:grid-cols-[minmax(0,1.25fr)_340px]">
      <div className="relative overflow-hidden rounded-lg bg-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.2)]">
        <div className="absolute left-4 top-4 z-10 rounded-full bg-black/35 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
          Puddle waiting room
        </div>
        <div className="grid min-h-[460px] place-items-center px-6 text-center text-white">
          <div>
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-sky-300 text-5xl font-semibold text-slate-950 shadow-[0_18px_55px_rgba(56,189,248,0.25)]">
              P
            </div>
            <h1 className="mt-6 text-3xl font-semibold leading-tight md:text-5xl">
              Your interview is ready.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-300">
              Check in, preview your devices, then join the live room.
            </p>
          </div>
        </div>
      </div>

      <aside className="flex min-h-[460px] flex-col justify-between rounded-lg border border-slate-200 bg-white p-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Invite</div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950">Join with Puddle</h2>
          <dl className="mt-6 grid gap-4 text-sm">
            <InfoRow label="Estimated time" value="30 minutes" />
            <InfoRow label="Devices" value="Camera and microphone" />
            <InfoRow label="Room" value="Live AI interviewer" />
          </dl>
        </div>
        <button
          type="button"
          onClick={onContinue}
          className="mt-7 w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold !text-white transition hover:bg-slate-800"
        >
          Continue
        </button>
      </aside>
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
    <div className="grid min-h-[620px] gap-6 bg-[#f8fbff] p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-lg border border-slate-200 bg-white p-5 sm:p-7">
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

      <aside className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/80">Puddle policy</div>
        <div className="mt-4 grid gap-3 text-sm text-slate-200">
          <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            The interviewer follows the assigned script.
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            Video integrity signals stay separate from scoring.
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            The session is saved for recruiter review.
          </div>
        </div>
      </aside>
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
  onEnterWaitingRoom,
}: {
  readonly status: CheckStatus;
  readonly error: string | null;
  readonly previewVideoRef: RefObject<HTMLVideoElement | null>;
  readonly canEnterRoom: boolean;
  readonly isJoining: boolean;
  readonly onBack: () => void;
  readonly onRunPreflight: () => void;
  readonly onEnterWaitingRoom: () => void;
}) {
  return (
    <div className="grid min-h-[620px] gap-6 bg-[#f8fbff] p-5 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_340px]">
      <div className="relative overflow-hidden rounded-lg bg-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
        <div className="absolute left-4 top-4 z-10 rounded-full bg-black/45 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur">
          Camera preview
        </div>
        <div className="absolute right-4 top-4 z-10 rounded-full bg-sky-300 px-3 py-1 text-xs font-semibold text-slate-950">
          Puddle
        </div>
        <div className="grid min-h-[520px]">
          <video
            ref={previewVideoRef}
            aria-label="Camera preview"
            autoPlay
            muted
            playsInline
            className="h-full min-h-[520px] w-full bg-slate-950 object-cover"
          />
          {status === "idle" ? (
            <div className="absolute inset-0 grid place-items-center bg-slate-950 text-center text-white">
              <div>
                <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-white/10 text-3xl font-semibold">
                  P
                </div>
                <div className="mt-4 text-lg font-semibold">Ready when you are</div>
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="absolute inset-x-4 bottom-24 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-lg">
            {error}
          </div>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/45 px-4 py-4 backdrop-blur">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            Back
          </button>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onRunPreflight}
              disabled={status === "checking"}
              className="rounded-full border border-white/20 bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/45"
            >
              {status === "checking" ? "Checking..." : status === "passed" ? "Check again" : "Use camera and mic"}
            </button>
            <button
              type="button"
              onClick={onEnterWaitingRoom}
              disabled={!canEnterRoom}
              className="rounded-full bg-sky-300 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/45"
            >
              {isJoining ? "Opening..." : "Enter waiting room"}
            </button>
          </div>
        </div>
      </div>

      <aside className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Waiting room</div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950">Join the live interview.</h2>
          <div className="mt-6 grid gap-3 text-sm">
            <StatusLine label="Camera" status={status} />
            <StatusLine label="Microphone" status={status} />
            <StatusLine label="Room token" status={canEnterRoom ? "passed" : "idle"} />
          </div>
        </div>
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          The next screen keeps your preview open while you wait to start the interview.
        </div>
      </aside>
    </div>
  );
}

function WaitingPanel({
  error,
  previewVideoRef,
  isJoining,
  roomStatus,
  isMicEnabled,
  isCameraEnabled,
  onToggleMic,
  onToggleCamera,
  onBack,
  onJoin,
}: {
  readonly error: string | null;
  readonly previewVideoRef: RefObject<HTMLVideoElement | null>;
  readonly isJoining: boolean;
  readonly roomStatus: string;
  readonly isMicEnabled: boolean;
  readonly isCameraEnabled: boolean;
  readonly onToggleMic: () => void;
  readonly onToggleCamera: () => void;
  readonly onBack: () => void;
  readonly onJoin: () => void;
}) {
  return (
    <div className="grid min-h-[620px] gap-6 bg-[#f8fbff] p-5 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_340px]">
      <div className="relative overflow-hidden rounded-lg bg-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
        <div className="absolute left-4 top-4 z-10 rounded-full bg-black/45 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur">
          Waiting room
        </div>
        <div className="absolute right-4 top-4 z-10 rounded-full bg-sky-300 px-3 py-1 text-xs font-semibold text-slate-950">
          Puddle
        </div>
        <video
          ref={previewVideoRef}
          aria-label="Camera preview"
          autoPlay
          muted
          playsInline
          className={`h-full min-h-[520px] w-full bg-slate-950 object-cover transition ${
            isCameraEnabled ? "opacity-100" : "opacity-0"
          }`}
        />
        {!isCameraEnabled ? (
          <div className="absolute inset-0 grid place-items-center bg-slate-950 text-center text-white">
            <div>
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-white/10 text-2xl font-semibold">
                You
              </div>
              <div className="mt-4 text-sm font-semibold text-slate-200">Camera is off</div>
            </div>
          </div>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/45 px-4 py-4 backdrop-blur">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            Back
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <ControlButton
              label={isMicEnabled ? "Mute microphone" : "Unmute microphone"}
              active={isMicEnabled}
              onClick={onToggleMic}
            >
              <MicIcon muted={!isMicEnabled} />
            </ControlButton>
            <ControlButton
              label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
              active={isCameraEnabled}
              onClick={onToggleCamera}
            >
              <CameraIcon disabled={!isCameraEnabled} />
            </ControlButton>
            <button
              type="button"
              onClick={onJoin}
              disabled={isJoining}
              className="rounded-full bg-sky-300 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/45"
            >
              {isJoining ? "Opening..." : "Join interview"}
            </button>
          </div>
        </div>
      </div>

      <aside className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Ready to join</div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950">You are in the waiting room.</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Keep this page open. Puddle will connect you to the live interviewer when you join.
          </p>

          <div className="mt-6 grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-slate-600">Microphone</span>
              <span className="font-semibold text-slate-950">{isMicEnabled ? "On" : "Muted"}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-slate-600">Camera</span>
              <span className="font-semibold text-slate-950">{isCameraEnabled ? "On" : "Off"}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-slate-600">Room</span>
              <span className="font-semibold text-slate-950">{isJoining ? roomStatus : "Ready"}</span>
            </div>
          </div>

          {error ? (
            <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          The interview starts only after you press Join interview.
        </div>
      </aside>
    </div>
  );
}

function ConnectingPanel({ roomStatus }: { readonly roomStatus: string }) {
  return (
    <div className="grid min-h-[620px] place-items-center bg-slate-950 p-8 text-center text-white">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-sky-300 text-2xl font-semibold text-slate-950">
          P
        </div>
        <div className="mx-auto mt-6 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-sky-300" />
        <h2 className="mt-5 text-2xl font-semibold">Opening your room</h2>
        <p className="mt-2 text-sm text-slate-300">{roomStatus}</p>
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
  isMicEnabled,
  isCameraEnabled,
  onToggleMic,
  onToggleCamera,
  onEnd,
}: {
  readonly join: JoinResponse | null;
  readonly roomStatus: string;
  readonly elapsedLabel: string;
  readonly remoteParticipants: number;
  readonly callVideoRef: RefObject<HTMLVideoElement | null>;
  readonly isMicEnabled: boolean;
  readonly isCameraEnabled: boolean;
  readonly onToggleMic: () => void;
  readonly onToggleCamera: () => void;
  readonly onEnd: () => void;
}) {
  return (
    <div className="min-h-[680px] bg-slate-950 text-white">
      <header className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-sky-300 text-sm font-semibold text-slate-950">
            P
          </div>
          <div>
            <div className="text-sm font-semibold">Puddle interview</div>
            <div className="text-xs text-slate-400">{join?.room ?? "Live room"}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-emerald-100">{roomStatus}</span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200">Elapsed {elapsedLabel}</span>
        </div>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="relative grid min-h-[420px] place-items-center overflow-hidden rounded-lg border border-white/10 bg-[#151b2a] text-center">
              <div className="absolute left-4 top-4 rounded-full bg-black/35 px-3 py-1 text-xs font-semibold text-white/85 backdrop-blur">
                Interviewer
              </div>
              <div>
                <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-sky-300 text-5xl font-semibold text-slate-950 shadow-[0_18px_55px_rgba(56,189,248,0.22)]">
                  P
                </div>
                <div className="mt-5 text-2xl font-semibold">Puddle interviewer</div>
                <div className="mt-2 text-sm text-slate-300">
                  {remoteParticipants > 0 ? "Connected" : "Waiting for interviewer audio"}
                </div>
              </div>
            </div>

            <div className="relative min-h-[220px] overflow-hidden rounded-lg border border-white/10 bg-slate-900">
              <video
                ref={callVideoRef}
                aria-label="Self view"
                autoPlay
                muted
                playsInline
                className={`h-full min-h-[220px] w-full object-cover transition ${
                  isCameraEnabled ? "opacity-100" : "opacity-0"
                }`}
              />
              {!isCameraEnabled ? (
                <div className="absolute inset-0 grid place-items-center bg-slate-900">
                  <div className="grid h-16 w-16 place-items-center rounded-full bg-white/10 text-xl font-semibold">
                    You
                  </div>
                </div>
              ) : null}
              <div className="absolute bottom-3 left-3 rounded-full bg-black/45 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur">
                You
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-3">
            <ControlButton
              label={isMicEnabled ? "Mute microphone" : "Unmute microphone"}
              active={isMicEnabled}
              onClick={onToggleMic}
            >
              <MicIcon muted={!isMicEnabled} />
            </ControlButton>
            <ControlButton
              label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
              active={isCameraEnabled}
              onClick={onToggleCamera}
            >
              <CameraIcon disabled={!isCameraEnabled} />
            </ControlButton>
            <button
              type="button"
              onClick={onEnd}
              className="grid h-12 min-w-16 place-items-center rounded-full bg-rose-600 px-5 text-sm font-semibold text-white transition hover:bg-rose-500"
            >
              Leave
            </button>
          </div>
        </div>

        <aside className="rounded-lg border border-white/10 bg-white/[0.06] p-4 [&_dd]:!text-slate-100">
          <div className="text-sm font-semibold">Session</div>
          <dl className="mt-4 grid gap-3 text-sm">
            <InfoRow label="Session" value={join?.sessionId ?? "-"} />
            <InfoRow label="Room" value={join?.room ?? "-"} />
            <InfoRow label="Status" value={roomStatus} />
            <InfoRow
              label="Participants"
              value={`${remoteParticipants} remote participant${remoteParticipants === 1 ? "" : "s"}`}
            />
          </dl>
        </aside>
      </div>
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

function StepPills({ current }: { readonly current: RoomStage }) {
  return (
    <div className="flex flex-wrap gap-2">
      {STEPS.map((step) => (
        <span
          key={step.id}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            isStepActive(current, step.id)
              ? "bg-slate-950 text-white"
              : isStepComplete(current, step.id)
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-500"
          }`}
        >
          {step.label}
        </span>
      ))}
    </div>
  );
}

function ControlButton({
  label,
  active,
  onClick,
  children,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-12 w-12 place-items-center rounded-full transition ${
        active ? "bg-white text-slate-950 hover:bg-slate-100" : "bg-rose-600 text-white hover:bg-rose-500"
      }`}
    >
      {children}
    </button>
  );
}

function MicIcon({ muted }: { readonly muted: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
      {muted ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function CameraIcon({ disabled }: { readonly disabled: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 10 20 7v10l-5-3" />
      <rect x="3" y="6" width="12" height="12" rx="2" />
      {disabled ? <path d="M4 4l16 16" /> : null}
    </svg>
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
  if (current === "connecting" && step === "waiting") {
    return true;
  }
  return current === step;
}

function isStepComplete(current: RoomStage, step: RoomStage): boolean {
  return stepOrder(current) > stepOrder(step);
}

function stepOrder(stage: RoomStage): number {
  if (stage === "connecting") {
    return stepOrder("waiting");
  }
  if (stage === "complete") {
    return STEPS.length;
  }
  return Math.max(
    0,
    STEPS.findIndex((step) => step.id === stage),
  );
}

async function setLocalTrackEnabled(
  track: LocalAudioTrack | LocalVideoTrack | null,
  enabled: boolean,
): Promise<void> {
  if (!track) {
    return;
  }

  if (enabled) {
    await track.unmute();
  } else {
    await track.mute();
  }
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
