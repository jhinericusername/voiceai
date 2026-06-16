"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
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

interface JoinErrorResponse {
  readonly error?: string;
  readonly code?: string;
}

type RoomStage = "waiting" | "connecting" | "live" | "left" | "ended";
type CheckStatus = "idle" | "checking" | "passed" | "failed";

interface ConsentState {
  readonly aiDisclosure: boolean;
  readonly recording: boolean;
  readonly dataUse: boolean;
}

const EMPTY_CONSENT: ConsentState = {
  aiDisclosure: false,
  recording: false,
  dataUse: false,
};

const FULL_CONSENT: ConsentState = {
  aiDisclosure: true,
  recording: true,
  dataUse: true,
};

const CONSENT_COPY: readonly { id: keyof ConsentState; label: string; detail: string }[] = [
  {
    id: "aiDisclosure",
    label: "I understand this interview is conducted by an AI interviewer.",
    detail:
      "The interviewer asks structured, role-related questions and may create rubric scores, rankings, recommendations, and review materials for human reviewers.",
  },
  {
    id: "recording",
    label: "I consent to audio, video, transcript, and interview-data processing.",
    detail: "Puddle records and transcribes the session so the hiring team can review the interview record against its rubric.",
  },
  {
    id: "dataUse",
    label: "I understand Puddle creates AI-assisted review outputs.",
    detail:
      "Puddle may generate rubric scores, rankings, and recommendations, but the hiring company is responsible for review and employment decisions. Review should be based on job-related answers, not appearance, emotion, age, race, gender, disability, accent, or facial expression.",
  },
];

export function InterviewJoinClient({ token }: InterviewJoinClientProps) {
  const [stage, setStage] = useState<RoomStage>("waiting");
  const [consent, setConsent] = useState<ConsentState>(EMPTY_CONSENT);
  const [preflightStatus, setPreflightStatus] = useState<CheckStatus>("idle");
  const [join, setJoin] = useState<JoinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [roomStatus, setRoomStatus] = useState("Not connected");
  const [remoteParticipants, setRemoteParticipants] = useState(0);
  const [interviewerDelayed, setInterviewerDelayed] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [isPreviewMicEnabled, setIsPreviewMicEnabled] = useState(true);
  const [isPreviewCameraEnabled, setIsPreviewCameraEnabled] = useState(true);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<RemoteTrack | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);

  const liveKitRoomRef = useRef<Room | null>(null);
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const localVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const callVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLDivElement | null>(null);

  const consentComplete = isConsentComplete(consent);
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
    setRemoteVideoTrack(null);
    setInterviewerDelayed(false);
    setIsMicEnabled(true);
    setIsCameraEnabled(true);
    liveKitRoomRef.current?.disconnect();
    liveKitRoomRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
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
    if (stage !== "live" || remoteParticipants > 0) {
      return;
    }

    const timeout = window.setTimeout(() => setInterviewerDelayed(true), 15_000);
    return () => window.clearTimeout(timeout);
  }, [remoteParticipants, stage]);

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
    const video = remoteVideoRef.current;
    if (!video || !remoteVideoTrack || stage !== "live") {
      return;
    }

    remoteVideoTrack.attach(video);
    void video.play().catch(() => {
      setError("Interviewer video was blocked by the browser. Click Leave, then rejoin the interview.");
    });
    return () => {
      remoteVideoTrack.detach(video);
    };
  }, [remoteVideoTrack, stage]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !previewStream || stage !== "waiting") {
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
      const payload = (await response.json()) as JoinErrorResponse | JoinResponse;

      if (!response.ok) {
        if ("code" in payload && payload.code === "session_ended") {
          cleanupRoom();
          stopPreview();
          setStage("ended");
          setError(payload.error ?? "This interview session has ended.");
          return;
        }
        setStage("waiting");
        setError(("error" in payload && payload.error) || "Could not join this interview.");
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

      const updateParticipants = () => {
        setInterviewerDelayed(false);
        setRemoteParticipants(room.remoteParticipants.size);
      };
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
      setInterviewerDelayed(false);
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
    if (track.kind === Track.Kind.Video) {
      setRemoteVideoTrack(track);
      return;
    }

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
    if (track.kind === Track.Kind.Video) {
      setRemoteVideoTrack((currentTrack) => (currentTrack === track ? null : currentTrack));
      return;
    }

    for (const element of track.detach()) {
      element.remove();
    }
  }

  function endInterview(): void {
    cleanupRoom();
    setError(null);
    setRoomStatus("Disconnected");
    setStage("left");
  }

  return (
    <section className="overflow-hidden rounded-[28px] bg-white shadow-[0_22px_70px_rgba(60,64,67,0.14)]">
      <div ref={remoteAudioRef} aria-hidden="true" className="fixed h-0 w-0 overflow-hidden" />

      {stage === "waiting" ? (
        <WaitingPanel
          consent={consent}
          status={preflightStatus}
          error={error}
          previewVideoRef={previewVideoRef}
          canEnterRoom={canEnterRoom}
          isJoining={isJoining}
          roomStatus={roomStatus}
          isMicEnabled={isPreviewMicEnabled}
          isCameraEnabled={isPreviewCameraEnabled}
          onConsentChange={setConsent}
          onRunPreflight={runPreflight}
          onToggleMic={togglePreviewMic}
          onToggleCamera={togglePreviewCamera}
          onJoin={enterRoom}
        />
      ) : null}

      {stage === "connecting" ? <ConnectingPanel roomStatus={roomStatus} /> : null}

      {stage === "live" ? (
        <LivePanel
          join={join}
          roomStatus={roomStatus}
          elapsedLabel={elapsedLabel}
          remoteParticipants={remoteParticipants}
          callVideoRef={callVideoRef}
          remoteVideoRef={remoteVideoRef}
          hasRemoteVideo={remoteVideoTrack !== null}
          interviewerDelayed={interviewerDelayed}
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

      {stage === "left" ? <LeftPanel isJoining={isJoining} roomStatus={roomStatus} onRejoin={enterRoom} /> : null}

      {stage === "ended" ? <EndedPanel detail={error} /> : null}
    </section>
  );
}

function WaitingPanel({
  consent,
  status,
  error,
  previewVideoRef,
  canEnterRoom,
  isJoining,
  roomStatus,
  isMicEnabled,
  isCameraEnabled,
  onConsentChange,
  onRunPreflight,
  onToggleMic,
  onToggleCamera,
  onJoin,
}: {
  readonly consent: ConsentState;
  readonly status: CheckStatus;
  readonly error: string | null;
  readonly previewVideoRef: RefObject<HTMLVideoElement | null>;
  readonly canEnterRoom: boolean;
  readonly isJoining: boolean;
  readonly roomStatus: string;
  readonly isMicEnabled: boolean;
  readonly isCameraEnabled: boolean;
  readonly onConsentChange: (consent: ConsentState) => void;
  readonly onRunPreflight: () => void;
  readonly onToggleMic: () => void;
  readonly onToggleCamera: () => void;
  readonly onJoin: () => void;
}) {
  const permissionsComplete = isConsentComplete(consent);
  const devicesReady = status === "passed";
  const previewVisible = devicesReady && isCameraEnabled;
  const joinHint = canEnterRoom ? "Ready" : "Complete the checks above";

  return (
    <div className="grid gap-5 bg-[#f8fafd] p-4 text-[#202124] lg:h-[calc(100svh-40px)] lg:min-h-[600px] lg:grid-cols-[minmax(0,1fr)_390px] lg:gap-5 lg:overflow-hidden lg:p-5">
      <div className="relative min-h-[330px] overflow-hidden rounded-[28px] bg-[#202124] shadow-[0_18px_46px_rgba(32,33,36,0.22)] lg:min-h-0">
        <video
          ref={previewVideoRef}
          aria-label="Camera preview"
          autoPlay
          muted
          playsInline
          style={{ transform: "scaleX(-1)" }}
          className={`h-full min-h-[330px] w-full bg-[#202124] object-cover transition duration-200 lg:min-h-0 ${
            previewVisible ? "opacity-100" : "opacity-0"
          }`}
        />

        {!previewVisible ? (
          <div className="absolute inset-0 grid place-items-center bg-[#202124] px-6 pb-24 text-center text-white">
            <div>
              <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#3c4043] text-3xl font-medium text-white">
                You
              </div>
              <div className="mt-5 text-lg font-medium">
                {devicesReady ? "Camera is off" : "Camera and microphone are off"}
              </div>
            </div>
          </div>
        ) : null}

        <div className="absolute left-4 top-4 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
          Camera preview
        </div>

        {error ? (
          <div className="absolute inset-x-4 bottom-28 rounded-2xl border border-[#f4c7c3] bg-[#fce8e6] px-4 py-3 text-sm text-[#b3261e] shadow-lg">
            {error}
          </div>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-4 pb-5 pt-12">
          <div className="flex items-center gap-3">
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
          </div>
          <button
            type="button"
            onClick={onRunPreflight}
            disabled={status === "checking"}
            className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#202124] shadow-sm transition hover:bg-[#f1f3f4] disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-white/60"
          >
            {status === "checking" ? "Checking..." : devicesReady ? "Check devices again" : "Allow camera and microphone"}
          </button>
        </div>
      </div>

      <aside className="flex flex-col py-2 lg:min-h-0">
        <div className="pt-2 text-center lg:pt-12 lg:text-left">
          <h1 className="text-4xl font-normal tracking-normal text-[#202124] sm:text-[44px]">Ready to join?</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#5f6368] lg:mx-0 lg:mt-3">
            Check your camera and microphone, then enter the live interview.
          </p>

          <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs lg:mt-5 lg:justify-start">
            <ReadinessRow label="Camera" ready={devicesReady && isCameraEnabled} />
            <ReadinessRow label="Microphone" ready={devicesReady && isMicEnabled} />
            <ReadinessRow label="Notices" ready={permissionsComplete} />
          </div>

          <div
            className={`mt-5 rounded-[18px] border p-3 text-left shadow-[0_1px_2px_rgba(60,64,67,0.12)] ${
              permissionsComplete ? "border-[#a8dab5] bg-[#f1f8f4]" : "border-[#dadce0] bg-white/80"
            }`}
          >
            <button
              type="button"
              aria-checked={permissionsComplete}
              role="checkbox"
              aria-label="Accept all required interview notices"
              className="flex cursor-pointer items-start gap-2.5 text-left text-[11px] font-medium text-[#202124]"
              onClick={() => onConsentChange(permissionsComplete ? EMPTY_CONSENT : FULL_CONSENT)}
              onKeyDown={(event) => {
                if (event.key === " ") {
                  event.preventDefault();
                  onConsentChange(permissionsComplete ? EMPTY_CONSENT : FULL_CONSENT);
                }
              }}
            >
              <span
                className={`mt-0.5 grid h-3.5 w-3.5 place-items-center rounded border ${
                  permissionsComplete
                    ? "border-[#137333] bg-[#e6f4ea] text-[#137333]"
                    : "border-[#80868b] bg-white text-[#1a73e8]"
                }`}
              >
                {permissionsComplete ? <MiniCheckIcon /> : null}
              </span>
              <span>Accept all required interview notices</span>
            </button>

            <p className="mt-2 border-t border-[#e8eaed] pt-2 text-[11px] leading-5 text-[#5f6368]">
              Review these notices before joining. You can request accommodation or an alternative process by contacting
              the hiring team or Puddle.
            </p>

            <div className="mt-2 grid gap-2">
              {CONSENT_COPY.map((item) => (
                <PermissionCheck
                  key={item.id}
                  checked={consent[item.id]}
                  label={item.label}
                  detail={item.detail}
                  onChange={(checked) =>
                    onConsentChange({
                      ...consent,
                      [item.id]: checked,
                    })
                  }
                />
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#e8eaed] pt-2 text-[10px] font-medium text-[#5f6368]">
              <Link href="/ai-interview-disclosure" target="_blank" rel="noreferrer" className="hover:text-[#202124]">
                AI interview disclosure
              </Link>
              <Link href="/privacy" target="_blank" rel="noreferrer" className="hover:text-[#202124]">
                Privacy
              </Link>
              <Link href="/terms" target="_blank" rel="noreferrer" className="hover:text-[#202124]">
                Terms
              </Link>
              <Link href="/subprocessors" target="_blank" rel="noreferrer" className="hover:text-[#202124]">
                Subprocessors
              </Link>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:flex-col">
            <button
              type="button"
              onClick={onJoin}
              disabled={!canEnterRoom}
              className="rounded-full bg-[#1a73e8] px-7 py-3 text-sm font-medium !text-white transition hover:bg-[#1765cc] disabled:cursor-not-allowed disabled:bg-[#dadce0] disabled:!text-[#80868b]"
            >
              {isJoining ? "Joining..." : "Join interview"}
            </button>
            <div className="min-h-4 text-center text-xs font-medium text-[#5f6368] lg:text-left">
              {isJoining ? roomStatus : joinHint}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ConnectingPanel({ roomStatus }: { readonly roomStatus: string }) {
  return (
    <div className="grid min-h-[700px] place-items-center bg-[#202124] p-8 text-center text-white">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#8ab4f8] text-2xl font-medium text-[#202124]">
          P
        </div>
        <div className="mx-auto mt-6 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[#8ab4f8]" />
        <h2 className="mt-5 text-2xl font-normal">Opening your room</h2>
        <p className="mt-2 text-sm text-[#bdc1c6]">{roomStatus}</p>
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
  remoteVideoRef,
  hasRemoteVideo,
  interviewerDelayed,
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
  readonly remoteVideoRef: RefObject<HTMLVideoElement | null>;
  readonly hasRemoteVideo: boolean;
  readonly interviewerDelayed: boolean;
  readonly isMicEnabled: boolean;
  readonly isCameraEnabled: boolean;
  readonly onToggleMic: () => void;
  readonly onToggleCamera: () => void;
  readonly onEnd: () => void;
}) {
  return (
    <div className="relative flex min-h-[calc(100svh-110px)] flex-col overflow-hidden bg-[#111214] text-white">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-5 py-4 text-sm">
        <div className="flex min-w-0 items-center gap-3 font-medium text-[#f1f3f4]">
          <span className="shrink-0">{elapsedLabel}</span>
          <span className="h-4 w-px shrink-0 bg-[#5f6368]" />
          <span className="truncate">{join?.room ?? "Puddle interview"}</span>
          <InfoIcon />
        </div>
        <div className="flex items-center justify-end gap-2 text-xs font-medium">
          <span className="rounded-full bg-[#5f6368] px-3 py-2 text-[#f1f3f4]">P</span>
          <span className="rounded-full bg-[#2b2c2f] px-3 py-2 text-[#e8eaed]">
            {remoteParticipants > 0 ? remoteParticipants + 1 : 1}
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-3 pb-28 pt-20 sm:px-5 md:pb-24">
        <div className="grid h-[min(72svh,760px)] min-h-[460px] w-full max-w-[1500px] grid-rows-2 gap-3 md:grid-cols-2 md:grid-rows-1">
          <div className="relative min-h-0 overflow-hidden rounded-[16px] bg-[#202124] shadow-[0_16px_44px_rgba(0,0,0,0.35)]">
            <video
              ref={remoteVideoRef}
              aria-label="Interviewer video"
              autoPlay
              playsInline
              className={`h-full w-full object-cover transition ${hasRemoteVideo ? "opacity-100" : "opacity-0"}`}
            />

            {!hasRemoteVideo ? (
              <div className="absolute inset-0 grid place-items-center bg-[#202124] px-6 text-center">
                <div>
                  <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#8ab4f8] text-4xl font-medium text-[#202124]">
                    P
                  </div>
                  <div className="mt-5 text-lg font-medium text-[#f1f3f4]">Puddle interviewer</div>
                  <div className="mt-2 text-sm text-[#bdc1c6]">
                    {remoteParticipants > 0
                      ? "Connected without video"
                      : interviewerDelayed
                        ? "Connecting interviewer..."
                        : "Waiting for interviewer"}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="absolute left-4 top-4 rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-[#f1f3f4] backdrop-blur">
              {hasRemoteVideo ? "Interviewer video" : interviewerDelayed ? "Connecting interviewer..." : roomStatus}
            </div>

            <div className="absolute bottom-4 left-4 rounded-md bg-black/60 px-3 py-1.5 text-sm font-medium text-white backdrop-blur">
              Puddle interviewer
            </div>
          </div>

          <div className="relative min-h-0 overflow-hidden rounded-[16px] bg-[#202124] shadow-[0_16px_44px_rgba(0,0,0,0.35)]">
            <video
              ref={callVideoRef}
              aria-label="Self view"
              autoPlay
              muted
              playsInline
              style={{ transform: "scaleX(-1)" }}
              className={`h-full w-full object-cover transition ${isCameraEnabled ? "opacity-100" : "opacity-0"}`}
            />

            {!isCameraEnabled ? (
              <div className="absolute inset-0 grid place-items-center bg-[#202124] px-6 text-center">
                <div>
                  <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#3c4043] text-3xl font-medium text-white">
                    You
                  </div>
                  <div className="mt-5 text-lg font-medium text-[#f1f3f4]">Camera is off</div>
                </div>
              </div>
            ) : null}

            <div className="absolute left-4 top-4 rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-[#f1f3f4] backdrop-blur">
              {isCameraEnabled ? "Your video" : "Camera off"}
            </div>

            <div className="absolute bottom-4 left-4 rounded-md bg-black/60 px-3 py-1.5 text-sm font-medium text-white backdrop-blur">
              You
            </div>
          </div>
        </div>
      </main>

      <footer className="absolute inset-x-0 bottom-0 z-20 grid gap-4 bg-gradient-to-t from-[#111214] via-[#111214]/95 to-transparent px-4 py-4 md:grid-cols-[1fr_auto_1fr] md:items-center md:px-5">
        <div className="hidden text-sm text-[#e8eaed] md:block">
          <span className="font-medium">{join?.sessionId ?? "Interview"}</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 md:grid md:grid-cols-[repeat(3,48px)_72px_48px] md:justify-items-center">
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
          <DisabledUtilityButton label="Captions">
            <CaptionsIcon />
          </DisabledUtilityButton>
          <button
            type="button"
            aria-label="Leave interview"
            title="Leave interview"
            onClick={onEnd}
            className="grid h-12 w-[72px] place-items-center rounded-full bg-[#ea4335] text-white transition hover:bg-[#d93025]"
          >
            <EndCallIcon />
          </button>
          <DisabledUtilityButton label="More options">
            <MoreIcon />
          </DisabledUtilityButton>
        </div>

        <div className="flex items-center justify-center gap-2 md:justify-end">
          <DisabledUtilityButton label="Meeting details">
            <InfoIcon />
          </DisabledUtilityButton>
          <DisabledUtilityButton label="People">
            <PeopleIcon />
          </DisabledUtilityButton>
          <DisabledUtilityButton label="Chat">
            <ChatIcon />
          </DisabledUtilityButton>
        </div>
      </footer>
    </div>
  );
}

function LeftPanel({
  isJoining,
  roomStatus,
  onRejoin,
}: {
  readonly isJoining: boolean;
  readonly roomStatus: string;
  readonly onRejoin: () => void;
}) {
  return (
    <div className="grid min-h-[620px] place-items-center bg-[#f8fafd] p-8 text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fce8e6] text-2xl text-[#b3261e]">
          <EndCallIcon />
        </div>
        <h2 className="mt-5 text-3xl font-normal text-[#202124]">You left the interview.</h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-[#5f6368]">
          The session remains available while the reconnect window is open.
        </p>
        <button
          type="button"
          onClick={onRejoin}
          disabled={isJoining}
          className="mt-6 rounded-full bg-[#1a73e8] px-7 py-3 text-sm font-medium !text-white transition hover:bg-[#1765cc] disabled:cursor-not-allowed disabled:bg-[#dadce0] disabled:!text-[#80868b]"
        >
          {isJoining ? "Rejoining..." : "Rejoin interview"}
        </button>
        <div className="mt-2 min-h-4 text-xs font-medium text-[#5f6368]">{isJoining ? roomStatus : null}</div>
      </div>
    </div>
  );
}

function EndedPanel({ detail }: { readonly detail: string | null }) {
  return (
    <div className="grid min-h-[620px] place-items-center bg-[#f8fafd] p-8 text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#f1f3f4] text-2xl text-[#5f6368]">
          <InfoIcon />
        </div>
        <h2 className="mt-5 text-3xl font-normal text-[#202124]">Session ended.</h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-[#5f6368]">
          {detail ?? "This interview is no longer available to rejoin."}
        </p>
      </div>
    </div>
  );
}

function ReadinessRow({ label, ready }: { readonly label: string; readonly ready: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${
        ready ? "border-[#a8dab5] bg-[#e6f4ea] text-[#137333]" : "border-[#f4c7c3] bg-[#fce8e6] text-[#b3261e]"
      }`}
    >
      <span>{label}</span>
      <span
        className={`grid h-5 w-5 place-items-center rounded-md border ${
          ready ? "border-[#137333]/30 bg-white/70" : "border-[#b3261e]/30 bg-white/70"
        }`}
      >
        {ready ? <MiniCheckIcon /> : <MiniXIcon />}
      </span>
    </div>
  );
}

function PermissionCheck({
  checked,
  label,
  detail,
  onChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly detail: string;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-[12px] border border-[#e8eaed] bg-[#f8fafd] px-2.5 py-2 text-left text-[10px] leading-4 text-[#5f6368]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-[#80868b] accent-[#1a73e8]"
      />
      <span>
        <span className="block font-medium text-[#202124]">{label}</span>
        <span className="mt-0.5 block">{detail}</span>
      </span>
    </label>
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
        active ? "bg-[#3c4043] text-white hover:bg-[#4a4d51]" : "bg-[#ea4335] text-white hover:bg-[#d93025]"
      }`}
    >
      {children}
    </button>
  );
}

function DisabledUtilityButton({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const [showMessage, setShowMessage] = useState(false);
  const disabledMessage = `${label} is disabled`;

  function showDisabledMessage(): void {
    setShowMessage(true);
    window.setTimeout(() => setShowMessage(false), 1600);
  }

  return (
    <span className="group relative inline-grid h-12 w-12 place-items-center">
      <button
        type="button"
        aria-disabled="true"
        aria-label={disabledMessage}
        title={disabledMessage}
        onClick={showDisabledMessage}
        className="grid h-10 w-10 cursor-not-allowed place-items-center rounded-full text-[#9aa0a6] opacity-70 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8ab4f8]"
      >
        {children}
      </button>
      <span
        role="status"
        className={`pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#202124] px-2.5 py-1.5 text-xs font-medium text-white shadow-lg transition ${
          showMessage ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
      >
        {disabledMessage}
      </span>
    </span>
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

function EndCallIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7.5 14.5a9 9 0 0 1 9 0" />
      <path d="M6 15.5 4.5 17a2 2 0 0 0 0 2.8l.2.2a2 2 0 0 0 2.8 0L9 18.5a2 2 0 0 0 .4-2.2" />
      <path d="M15 18.5 16.5 20a2 2 0 0 0 2.8 0l.2-.2a2 2 0 0 0 0-2.8L18 15.5a2 2 0 0 0-3 .8" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 19a4 4 0 0 0-8 0" />
      <circle cx="12" cy="9" r="3" />
      <path d="M22 19a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M2 19a4 4 0 0 1 3-3.87" />
      <path d="M8 3.13a4 4 0 0 0 0 7.75" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
    </svg>
  );
}

function CaptionsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M8 10h3" />
      <path d="M14 10h2" />
      <path d="M8 14h2" />
      <path d="M13 14h3" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function MiniCheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.25">
      <path d="m3.5 8 3 3 6-6" />
    </svg>
  );
}

function MiniXIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.25">
      <path d="m4.5 4.5 7 7" />
      <path d="m11.5 4.5-7 7" />
    </svg>
  );
}

function isConsentComplete(consent: ConsentState): boolean {
  return consent.aiDisclosure && consent.recording && consent.dataUse;
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
