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

interface InterviewerJoinClientProps {
  readonly sessionId: string;
}

interface CandidateInvite {
  readonly candidateInviteUrl: string;
  readonly inviteExpiresAt: string;
}

interface InterviewerJoinResponse {
  readonly sessionId: string;
  readonly room: string;
  readonly liveKitUrl: string;
  readonly token: string;
  readonly aiInterviewerState: AiInterviewerState;
}

interface InterviewerConnectedResponse {
  readonly sessionId: string;
  readonly room: string;
}

interface AiControlResponse {
  readonly sessionId: string;
  readonly aiInterviewerState: AiInterviewerState;
  readonly requestedAt: string;
}

type AiInterviewerState = "not_started" | "running" | "stopped";
type AiControlAction = "start" | "stop" | "resume";
type RoomStage = "waiting" | "connecting" | "live" | "left" | "ended";
type CheckStatus = "idle" | "checking" | "passed" | "failed";
type InviteStatus = "idle" | "loading" | "ready" | "error";
type CopyStatus = "idle" | "copied" | "failed";

const AI_INTERVIEWER_STATES = new Set<AiInterviewerState>(["not_started", "running", "stopped"]);
const HOST_ROOM_OPEN_ERROR = "The host room could not be opened. Refresh and try again.";

const AI_CONTROL_BY_STATE: Record<
  AiInterviewerState,
  { readonly action: AiControlAction; readonly label: string }
> = {
  not_started: {
    action: "start",
    label: "Start AI",
  },
  running: {
    action: "stop",
    label: "Stop AI",
  },
  stopped: {
    action: "resume",
    label: "Resume AI",
  },
};

export function InterviewerJoinClient({ sessionId }: InterviewerJoinClientProps) {
  const [stage, setStage] = useState<RoomStage>("waiting");
  const [candidateInvite, setCandidateInvite] = useState<CandidateInvite | null>(null);
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("idle");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [preflightStatus, setPreflightStatus] = useState<CheckStatus>("idle");
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [isPreviewMicEnabled, setIsPreviewMicEnabled] = useState(true);
  const [isPreviewCameraEnabled, setIsPreviewCameraEnabled] = useState(true);
  const [join, setJoin] = useState<InterviewerJoinResponse | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [roomStatus, setRoomStatus] = useState("Not connected");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState(0);
  const [candidateDelayed, setCandidateDelayed] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<RemoteTrack | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [aiInterviewerState, setAiInterviewerState] = useState<AiInterviewerState>("not_started");
  const [aiControlPending, setAiControlPending] = useState(false);

  const liveKitRoomRef = useRef<Room | null>(null);
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const localVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const callVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLDivElement | null>(null);
  const inviteRequestedRef = useRef(false);
  const copyResetTimerRef = useRef<number | null>(null);

  const elapsedLabel = useMemo(() => formatDuration(elapsedSeconds), [elapsedSeconds]);
  const encodedSessionId = useMemo(() => encodeURIComponent(sessionId), [sessionId]);
  const candidateInviteUrl = candidateInvite?.candidateInviteUrl ?? "";

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
    setCandidateDelayed(false);
    setRemoteParticipants(0);
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

  const createCandidateInvite = useCallback(async (): Promise<void> => {
    setInviteStatus("loading");
    setInviteError(null);
    setCopyStatus("idle");

    try {
      const response = await fetch(`/api/dashboard/interviews/${encodedSessionId}/candidate-invite`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        setInviteStatus("error");
        setInviteError(errorFromPayload(payload, "Candidate link could not be created."));
        return;
      }

      if (!isCandidateInvite(payload)) {
        setInviteStatus("error");
        setInviteError("Candidate invite response was malformed.");
        return;
      }

      setCandidateInvite(payload);
      setInviteStatus("ready");
    } catch {
      setInviteStatus("error");
      setInviteError("Candidate link could not be created. Try again.");
    }
  }, [encodedSessionId]);

  const attachRemoteTrack = useCallback((track: RemoteTrack): void => {
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
      setRoomError("Candidate audio was blocked by the browser. Leave, then rejoin the room.");
    });
  }, []);

  const detachRemoteTrack = useCallback((track: RemoteTrack): void => {
    if (track.kind === Track.Kind.Video) {
      setRemoteVideoTrack((currentTrack) => (currentTrack === track ? null : currentTrack));
      return;
    }

    for (const element of track.detach()) {
      element.remove();
    }
  }, []);

  const runPreflight = useCallback(async (): Promise<void> => {
    setPreflightStatus("checking");
    setRoomError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setPreflightStatus("failed");
      setRoomError("This browser cannot access camera and microphone devices.");
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
      setRoomError("Camera or microphone access was blocked. Allow access and try again.");
    }
  }, [stopPreview]);

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

  const copyCandidateLink = useCallback(async (): Promise<void> => {
    if (!candidateInviteUrl) {
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }

      await navigator.clipboard.writeText(candidateInviteUrl);
      setCopyStatus("copied");
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => setCopyStatus("idle"), 1800);
    } catch {
      setCopyStatus("failed");
      setInviteError("Copy failed. Select and copy the candidate URL.");
    }
  }, [candidateInviteUrl]);

  const enterRoom = useCallback(async (): Promise<void> => {
    if (isJoining || stage === "connecting") {
      return;
    }

    const publishAudioEnabled = isPreviewMicEnabled;
    const publishVideoEnabled = isPreviewCameraEnabled;

    setIsJoining(true);
    setRoomError(null);
    setStage("connecting");
    setRoomStatus("Requesting host credentials");

    try {
      const response = await fetch(`/api/dashboard/interviews/${encodedSessionId}/interviewer-join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        cleanupRoom();
        stopPreview();
        setStage(isSessionEndedPayload(payload) ? "ended" : "waiting");
        setRoomStatus("Not connected");
        setRoomError(errorFromPayload(payload, "Interviewer could not join this interview."));
        return;
      }

      if (!isInterviewerJoinResponse(payload)) {
        cleanupRoom();
        setStage("waiting");
        setRoomStatus("Not connected");
        setRoomError("Interviewer join response was malformed.");
        return;
      }

      setJoin(payload);
      setAiInterviewerState(payload.aiInterviewerState);
      setRoomStatus("Connecting to room");

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      liveKitRoomRef.current = room;

      const updateParticipants = () => {
        setCandidateDelayed(false);
        setRemoteParticipants(room.remoteParticipants.size);
      };
      room.on(RoomEvent.Connected, () => setRoomStatus("Connected"));
      room.on(RoomEvent.Disconnected, () => setRoomStatus("Disconnected"));
      room.on(RoomEvent.ParticipantConnected, updateParticipants);
      room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
      room.on(RoomEvent.TrackSubscribed, attachRemoteTrack);
      room.on(RoomEvent.TrackUnsubscribed, detachRemoteTrack);

      await room.connect(payload.liveKitUrl, payload.token);
      updateParticipants();

      stopPreview();
      const audioTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      localAudioTrackRef.current = audioTrack;

      const videoTrack = await createLocalVideoTrack({
        facingMode: "user",
      });
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

      setRoomStatus("Acknowledging host presence");
      const connectedResponse = await fetch(`/api/dashboard/interviews/${encodedSessionId}/interviewer-connected`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      });
      const connectedPayload = await parseJsonResponse(connectedResponse);

      if (!connectedResponse.ok) {
        throw new InterviewerConnectedAcknowledgementError(
          errorFromPayload(connectedPayload, "Interviewer presence could not be acknowledged."),
        );
      }

      if (!isInterviewerConnectedResponse(connectedPayload)) {
        throw new InterviewerConnectedAcknowledgementError("Interviewer connected response was malformed.");
      }

      setElapsedSeconds(0);
      setCandidateDelayed(false);
      setRoomStatus("Connected");
      setStage("live");
    } catch (error) {
      cleanupRoom();
      setStage("waiting");
      setRoomStatus("Not connected");
      setRoomError(
        error instanceof InterviewerConnectedAcknowledgementError ? error.message : HOST_ROOM_OPEN_ERROR,
      );
    } finally {
      setIsJoining(false);
    }
  }, [
    attachRemoteTrack,
    cleanupRoom,
    detachRemoteTrack,
    encodedSessionId,
    isJoining,
    isPreviewCameraEnabled,
    isPreviewMicEnabled,
    stage,
    stopPreview,
  ]);

  const toggleLiveMic = useCallback((): void => {
    setIsMicEnabled((current) => {
      const next = !current;
      void setLocalTrackEnabled(localAudioTrackRef.current, next);
      return next;
    });
  }, []);

  const toggleLiveCamera = useCallback((): void => {
    setIsCameraEnabled((current) => {
      const next = !current;
      void setLocalTrackEnabled(localVideoTrackRef.current, next);
      return next;
    });
  }, []);

  const requestAiControl = useCallback(async (): Promise<void> => {
    if (aiControlPending) {
      return;
    }

    const control = AI_CONTROL_BY_STATE[aiInterviewerState];
    setAiControlPending(true);
    setRoomError(null);

    try {
      const response = await fetch(`/api/dashboard/interviews/${encodedSessionId}/ai-control`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: control.action }),
      });
      const payload = await parseJsonResponse(response);

      if (!response.ok) {
        setRoomError(errorFromPayload(payload, "AI interviewer control request failed."));
        return;
      }

      if (!isAiControlResponse(payload)) {
        setRoomError("AI interviewer control response was malformed.");
        return;
      }

      setAiInterviewerState(payload.aiInterviewerState);
    } catch {
      setRoomError("AI interviewer control request failed.");
    } finally {
      setAiControlPending(false);
    }
  }, [aiControlPending, aiInterviewerState, encodedSessionId]);

  const endCall = useCallback((): void => {
    cleanupRoom();
    setRoomError(null);
    setRoomStatus("Disconnected");
    setStage("left");
  }, [cleanupRoom]);

  useEffect(() => {
    if (inviteRequestedRef.current) {
      return;
    }
    inviteRequestedRef.current = true;
    void createCandidateInvite();
  }, [createCandidateInvite]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
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

    const timeout = window.setTimeout(() => setCandidateDelayed(true), 15_000);
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
      setRoomError("Candidate video was blocked by the browser. Leave, then rejoin the room.");
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

  return (
    <section className="min-h-svh bg-[#f8fafd] text-[#202124]">
      <div ref={remoteAudioRef} aria-hidden="true" className="fixed h-0 w-0 overflow-hidden" />

      {stage === "waiting" ? (
        <WaitingPanel
          candidateInvite={candidateInvite}
          copyStatus={copyStatus}
          inviteError={inviteError}
          inviteStatus={inviteStatus}
          isJoining={isJoining}
          isMicEnabled={isPreviewMicEnabled}
          isCameraEnabled={isPreviewCameraEnabled}
          preflightStatus={preflightStatus}
          previewVideoRef={previewVideoRef}
          roomError={roomError}
          roomStatus={roomStatus}
          onCopyCandidateLink={copyCandidateLink}
          onCreateCandidateInvite={createCandidateInvite}
          onJoin={enterRoom}
          onRunPreflight={runPreflight}
          onToggleCamera={togglePreviewCamera}
          onToggleMic={togglePreviewMic}
        />
      ) : null}

      {stage === "connecting" ? <ConnectingPanel roomStatus={roomStatus} /> : null}

      {stage === "live" ? (
        <LivePanel
          aiControlPending={aiControlPending}
          aiInterviewerState={aiInterviewerState}
          candidateDelayed={candidateDelayed}
          callVideoRef={callVideoRef}
          elapsedLabel={elapsedLabel}
          hasRemoteVideo={remoteVideoTrack !== null}
          isCameraEnabled={isCameraEnabled}
          isMicEnabled={isMicEnabled}
          join={join}
          remoteParticipants={remoteParticipants}
          remoteVideoRef={remoteVideoRef}
          roomError={roomError}
          roomStatus={roomStatus}
          onAiControl={requestAiControl}
          onEnd={endCall}
          onToggleCamera={toggleLiveCamera}
          onToggleMic={toggleLiveMic}
        />
      ) : null}

      {stage === "left" ? <LeftPanel isJoining={isJoining} roomStatus={roomStatus} onRejoin={enterRoom} /> : null}

      {stage === "ended" ? <EndedPanel detail={roomError} /> : null}
    </section>
  );
}

function WaitingPanel({
  candidateInvite,
  copyStatus,
  inviteError,
  inviteStatus,
  isJoining,
  isMicEnabled,
  isCameraEnabled,
  preflightStatus,
  previewVideoRef,
  roomError,
  roomStatus,
  onCopyCandidateLink,
  onCreateCandidateInvite,
  onJoin,
  onRunPreflight,
  onToggleCamera,
  onToggleMic,
}: {
  readonly candidateInvite: CandidateInvite | null;
  readonly copyStatus: CopyStatus;
  readonly inviteError: string | null;
  readonly inviteStatus: InviteStatus;
  readonly isJoining: boolean;
  readonly isMicEnabled: boolean;
  readonly isCameraEnabled: boolean;
  readonly preflightStatus: CheckStatus;
  readonly previewVideoRef: RefObject<HTMLVideoElement | null>;
  readonly roomError: string | null;
  readonly roomStatus: string;
  readonly onCopyCandidateLink: () => void;
  readonly onCreateCandidateInvite: () => void;
  readonly onJoin: () => void;
  readonly onRunPreflight: () => void;
  readonly onToggleCamera: () => void;
  readonly onToggleMic: () => void;
}) {
  const devicesReady = preflightStatus === "passed";
  const previewVisible = devicesReady && isCameraEnabled;
  const inviteReady = inviteStatus === "ready" && candidateInvite !== null;
  const copyLabel = copyStatus === "copied" ? "Copied" : "Copy candidate link";

  return (
    <div className="grid min-h-svh gap-5 bg-[#f8fafd] p-4 text-[#202124] lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-5 lg:overflow-hidden lg:p-5">
      <div className="relative min-h-[360px] overflow-hidden rounded-[28px] bg-[#202124] shadow-[0_18px_46px_rgba(32,33,36,0.22)] lg:min-h-0">
        <video
          ref={previewVideoRef}
          aria-label="Host camera preview"
          autoPlay
          muted
          playsInline
          style={{ transform: "scaleX(-1)" }}
          className={`h-full min-h-[360px] w-full bg-[#202124] object-cover transition duration-200 lg:min-h-0 ${
            previewVisible ? "opacity-100" : "opacity-0"
          }`}
        />

        {!previewVisible ? (
          <div className="absolute inset-0 grid place-items-center bg-[#202124] px-6 pb-24 text-center text-white">
            <div>
              <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#3c4043] text-3xl font-medium text-white">
                Host
              </div>
              <div className="mt-5 text-lg font-medium">
                {devicesReady ? "Camera is off" : "Camera and microphone are off"}
              </div>
            </div>
          </div>
        ) : null}

        <div className="absolute left-4 top-4 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
          Host preview
        </div>

        {roomError ? (
          <div className="absolute inset-x-4 bottom-28 rounded-2xl border border-[#f4c7c3] bg-[#fce8e6] px-4 py-3 text-sm text-[#b3261e] shadow-lg">
            {roomError}
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
            disabled={preflightStatus === "checking"}
            className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#202124] shadow-sm transition hover:bg-[#f1f3f4] disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-white/60"
          >
            {preflightStatus === "checking"
              ? "Checking..."
              : devicesReady
                ? "Check devices again"
                : "Allow camera and microphone"}
          </button>
        </div>
      </div>

      <aside className="flex flex-col py-2 lg:min-h-0">
        <div className="pt-2 text-center lg:pt-12 lg:text-left">
          <h1 className="text-4xl font-normal tracking-normal text-[#202124] sm:text-[44px]">Join as host</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#5f6368] lg:mx-0 lg:mt-3">
            Share the candidate link, check your devices, and open the live interview room when you are ready.
          </p>

          <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs lg:mt-5 lg:justify-start">
            <ReadinessRow label="Candidate link" ready={inviteReady} />
            <ReadinessRow label="Camera" ready={devicesReady && isCameraEnabled} />
            <ReadinessRow label="Microphone" ready={devicesReady && isMicEnabled} />
          </div>

          <div className="mt-5 rounded-[18px] border border-[#dadce0] bg-white/85 p-3 text-left shadow-[0_1px_2px_rgba(60,64,67,0.12)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#5f6368]">Candidate URL</div>
                <div className="mt-1 text-sm font-medium text-[#202124]">
                  {inviteStatus === "loading" ? "Creating link..." : inviteReady ? "Ready to share" : "Link unavailable"}
                </div>
              </div>
              <button
                type="button"
                onClick={onCreateCandidateInvite}
                disabled={inviteStatus === "loading"}
                className="shrink-0 rounded-full border border-[#dadce0] bg-white px-3 py-2 text-xs font-medium text-[#202124] transition hover:bg-[#f1f3f4] disabled:cursor-not-allowed disabled:bg-[#f1f3f4] disabled:text-[#80868b]"
              >
                {inviteReady ? "Create new link" : "Retry"}
              </button>
            </div>

            {inviteReady ? (
              <div className="mt-3 grid gap-2">
                <input
                  readOnly
                  aria-label="Candidate invite URL"
                  value={candidateInvite.candidateInviteUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 rounded-[12px] border border-[#dadce0] bg-[#f8fafd] px-3 py-2.5 text-sm text-[#202124] outline-none focus:border-[#1a73e8]"
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={onCopyCandidateLink}
                    className="rounded-full bg-[#1a73e8] px-5 py-2.5 text-sm font-medium !text-white transition hover:bg-[#1765cc]"
                  >
                    {copyLabel}
                  </button>
                  <div className="min-h-5 text-xs font-medium text-[#5f6368] sm:flex sm:items-center">
                    {copyStatus === "failed"
                      ? "Select the URL to copy it manually."
                      : formatInviteExpiry(candidateInvite.inviteExpiresAt)}
                  </div>
                </div>
              </div>
            ) : null}

            {inviteError ? (
              <div className="mt-3 rounded-[12px] border border-[#f4c7c3] bg-[#fce8e6] px-3 py-2 text-sm text-[#b3261e]">
                {inviteError}
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:flex-col">
            <button
              type="button"
              onClick={onJoin}
              disabled={isJoining}
              className="rounded-full bg-[#1a73e8] px-7 py-3 text-sm font-medium !text-white transition hover:bg-[#1765cc] disabled:cursor-not-allowed disabled:bg-[#dadce0] disabled:!text-[#80868b]"
            >
              {isJoining ? "Joining..." : "Join room as host"}
            </button>
            <div className="min-h-4 text-center text-xs font-medium text-[#5f6368] lg:text-left">
              {isJoining ? roomStatus : devicesReady ? "Ready" : "Camera and microphone can also be enabled after join"}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ConnectingPanel({ roomStatus }: { readonly roomStatus: string }) {
  return (
    <div className="grid min-h-svh place-items-center bg-[#202124] p-8 text-center text-white">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#8ab4f8] text-2xl font-medium text-[#202124]">
          P
        </div>
        <div className="mx-auto mt-6 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[#8ab4f8]" />
        <h2 className="mt-5 text-2xl font-normal">Opening host room</h2>
        <p className="mt-2 text-sm text-[#bdc1c6]">{roomStatus}</p>
      </div>
    </div>
  );
}

function LivePanel({
  aiControlPending,
  aiInterviewerState,
  candidateDelayed,
  callVideoRef,
  elapsedLabel,
  hasRemoteVideo,
  isCameraEnabled,
  isMicEnabled,
  join,
  remoteParticipants,
  remoteVideoRef,
  roomError,
  roomStatus,
  onAiControl,
  onEnd,
  onToggleCamera,
  onToggleMic,
}: {
  readonly aiControlPending: boolean;
  readonly aiInterviewerState: AiInterviewerState;
  readonly candidateDelayed: boolean;
  readonly callVideoRef: RefObject<HTMLVideoElement | null>;
  readonly elapsedLabel: string;
  readonly hasRemoteVideo: boolean;
  readonly isCameraEnabled: boolean;
  readonly isMicEnabled: boolean;
  readonly join: InterviewerJoinResponse | null;
  readonly remoteParticipants: number;
  readonly remoteVideoRef: RefObject<HTMLVideoElement | null>;
  readonly roomError: string | null;
  readonly roomStatus: string;
  readonly onAiControl: () => void;
  readonly onEnd: () => void;
  readonly onToggleCamera: () => void;
  readonly onToggleMic: () => void;
}) {
  const aiControl = AI_CONTROL_BY_STATE[aiInterviewerState];

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-[#111214] text-white">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-5 py-4 text-sm">
        <div className="flex min-w-0 items-center gap-3 font-medium text-[#f1f3f4]">
          <span className="shrink-0">{elapsedLabel}</span>
          <span className="h-4 w-px shrink-0 bg-[#5f6368]" />
          <span className="truncate">{join?.room ?? "Puddle interview"}</span>
          <InfoIcon />
        </div>
        <div className="flex items-center justify-end gap-2 text-xs font-medium">
          <span className="rounded-full bg-[#5f6368] px-3 py-2 text-[#f1f3f4]">Host</span>
          <span className="rounded-full bg-[#2b2c2f] px-3 py-2 text-[#e8eaed]">
            {remoteParticipants > 0 ? remoteParticipants + 1 : 1}
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-3 pb-32 pt-20 sm:px-5 md:pb-28">
        <div className="grid h-[min(72svh,760px)] min-h-[460px] w-full max-w-[1500px] grid-rows-2 gap-3 md:grid-cols-2 md:grid-rows-1">
          <div className="relative min-h-0 overflow-hidden rounded-[16px] bg-[#202124] shadow-[0_16px_44px_rgba(0,0,0,0.35)]">
            <video
              ref={remoteVideoRef}
              aria-label="Candidate video"
              autoPlay
              playsInline
              className={`h-full w-full object-cover transition ${hasRemoteVideo ? "opacity-100" : "opacity-0"}`}
            />

            {!hasRemoteVideo ? (
              <div className="absolute inset-0 grid place-items-center bg-[#202124] px-6 text-center">
                <div>
                  <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#8ab4f8] text-4xl font-medium text-[#202124]">
                    C
                  </div>
                  <div className="mt-5 text-lg font-medium text-[#f1f3f4]">Candidate</div>
                  <div className="mt-2 text-sm text-[#bdc1c6]">
                    {remoteParticipants > 0
                      ? "Connected without video"
                      : candidateDelayed
                        ? "Candidate has not joined yet"
                        : "Waiting for candidate"}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="absolute left-4 top-4 rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-[#f1f3f4] backdrop-blur">
              {hasRemoteVideo ? "Candidate video" : candidateDelayed ? "Waiting for candidate" : roomStatus}
            </div>

            <div className="absolute bottom-4 left-4 rounded-md bg-black/60 px-3 py-1.5 text-sm font-medium text-white backdrop-blur">
              Candidate
            </div>
          </div>

          <div className="relative min-h-0 overflow-hidden rounded-[16px] bg-[#202124] shadow-[0_16px_44px_rgba(0,0,0,0.35)]">
            <video
              ref={callVideoRef}
              aria-label="Host self view"
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
                    Host
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

      {roomError ? (
        <div className="absolute inset-x-4 bottom-28 z-30 mx-auto max-w-xl rounded-2xl border border-[#f4c7c3] bg-[#fce8e6] px-4 py-3 text-sm text-[#b3261e] shadow-lg md:bottom-24">
          {roomError}
        </div>
      ) : null}

      <footer className="absolute inset-x-0 bottom-0 z-20 grid gap-4 bg-gradient-to-t from-[#111214] via-[#111214]/95 to-transparent px-4 py-4 md:grid-cols-[1fr_auto_1fr] md:items-center md:px-5">
        <div className="hidden text-sm text-[#e8eaed] md:block">
          <span className="font-medium">{join?.sessionId ?? "Interview"}</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
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
            aria-label="Leave interview"
            title="Leave interview"
            onClick={onEnd}
            className="grid h-12 w-[72px] place-items-center rounded-full bg-[#ea4335] text-white transition hover:bg-[#d93025]"
          >
            <EndCallIcon />
          </button>
          <button
            type="button"
            aria-busy={aiControlPending}
            disabled={aiControlPending}
            onClick={onAiControl}
            className={`h-12 min-w-[104px] rounded-full px-5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-70 ${
              aiInterviewerState === "running" ? "bg-[#3c4043] hover:bg-[#4a4d51]" : "bg-[#1a73e8] hover:bg-[#1765cc]"
            }`}
          >
            {aiControl.label}
          </button>
        </div>

        <div className="hidden items-center justify-end gap-2 md:flex">
          <div className="rounded-full bg-[#2b2c2f] px-3 py-2 text-xs font-medium text-[#e8eaed]">
            AI: {aiInterviewerState.replace("_", " ")}
          </div>
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
    <div className="grid min-h-svh place-items-center bg-[#f8fafd] p-8 text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fce8e6] text-2xl text-[#b3261e]">
          <EndCallIcon />
        </div>
        <h2 className="mt-5 text-3xl font-normal text-[#202124]">You left the room.</h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-[#5f6368]">
          The interview room remains available while the session is open.
        </p>
        <button
          type="button"
          onClick={onRejoin}
          disabled={isJoining}
          className="mt-6 rounded-full bg-[#1a73e8] px-7 py-3 text-sm font-medium !text-white transition hover:bg-[#1765cc] disabled:cursor-not-allowed disabled:bg-[#dadce0] disabled:!text-[#80868b]"
        >
          {isJoining ? "Rejoining..." : "Rejoin room"}
        </button>
        <div className="mt-2 min-h-4 text-xs font-medium text-[#5f6368]">{isJoining ? roomStatus : null}</div>
      </div>
    </div>
  );
}

function EndedPanel({ detail }: { readonly detail: string | null }) {
  return (
    <div className="grid min-h-svh place-items-center bg-[#f8fafd] p-8 text-center">
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

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorFromPayload(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
}

function isCandidateInvite(value: unknown): value is CandidateInvite {
  return (
    isRecord(value) &&
    typeof value.candidateInviteUrl === "string" &&
    typeof value.inviteExpiresAt === "string"
  );
}

function isInterviewerJoinResponse(value: unknown): value is InterviewerJoinResponse {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.room === "string" &&
    typeof value.liveKitUrl === "string" &&
    typeof value.token === "string" &&
    isAiInterviewerState(value.aiInterviewerState)
  );
}

function isInterviewerConnectedResponse(value: unknown): value is InterviewerConnectedResponse {
  return isRecord(value) && typeof value.sessionId === "string" && typeof value.room === "string";
}

function isAiControlResponse(value: unknown): value is AiControlResponse {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    isAiInterviewerState(value.aiInterviewerState) &&
    typeof value.requestedAt === "string"
  );
}

function isAiInterviewerState(value: unknown): value is AiInterviewerState {
  return typeof value === "string" && AI_INTERVIEWER_STATES.has(value as AiInterviewerState);
}

function isSessionEndedPayload(payload: unknown): boolean {
  return isRecord(payload) && payload.code === "session_ended";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatInviteExpiry(inviteExpiresAt: string): string {
  const expiresAt = new Date(inviteExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return "Link expiration unavailable";
  }

  return `Expires ${expiresAt.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

class InterviewerConnectedAcknowledgementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterviewerConnectedAcknowledgementError";
  }
}
