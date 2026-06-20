import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  RoomEvent,
  Track,
  createAudioAnalyser,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
} from "livekit-client";
import { connectToInterview, type RoomConnection } from "../livekit.js";
import type { JoinDetails } from "../session.js";

interface InCallProps {
  readonly join: JoinDetails;
  readonly onComplete: () => void;
}

const COLORS = {
  bg: "#111214",
  tile: "#202124",
  agentTile: "#1b1c1f",
  accent: "#8ab4f8",
  text: "#f1f3f4",
  sub: "#bdc1c6",
  red: "#ea4335",
  grey: "#3c4043",
} as const;

const PUDDLE_SYMBOL = "/puddle-symbol-white-nobg.svg";
const AGENT_WAVE_BARS = [0, 0.18, 0.36, 0.12, 0.3, 0.06, 0.24];

function isInterviewer(participant: RemoteParticipant | undefined): boolean {
  return String(participant?.identity ?? "").startsWith("interviewer-");
}

// Candidate in-call screen. Mirrors the host meeting UI (host video · Puddle AI ·
// self-view) minus any host-only controls (no Start/Stop AI). The candidate
// infers AI presence from the agent participant being in the room.
export function InCall({ join, onComplete }: InCallProps): JSX.Element {
  const [status, setStatus] = useState<"connecting" | "live" | "ended">("connecting");
  const [needsAudioGesture, setNeedsAudioGesture] = useState(false);
  const [selfStream, setSelfStream] = useState<MediaStream | null>(null);
  const [hostVideo, setHostVideo] = useState<RemoteVideoTrack | null>(null);
  const [agentAudio, setAgentAudio] = useState<RemoteAudioTrack | null>(null);
  const [agentPresent, setAgentPresent] = useState(false);
  const [hasAgentAppeared, setHasAgentAppeared] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const connRef = useRef<RoomConnection | null>(null);
  const selfVideoRef = useRef<HTMLVideoElement>(null);
  const hostVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    connectToInterview(
      join.wsUrl,
      join.token,
      (audioEl) => document.body.appendChild(audioEl),
      (videoTrack) => setSelfStream(new MediaStream([videoTrack])),
      (canPlayback) => setNeedsAudioGesture(!canPlayback),
    )
      .then((conn) => {
        if (cancelled) {
          void conn.disconnect();
          return;
        }
        connRef.current = conn;
        setStatus("live");
        const room = conn.room;

        const onSub = (
          track: RemoteTrack,
          _pub: RemoteTrackPublication,
          participant: RemoteParticipant,
        ): void => {
          if (participant?.isAgent) {
            if (track.kind === Track.Kind.Audio) setAgentAudio(track as RemoteAudioTrack);
          } else if (isInterviewer(participant) && track.kind === Track.Kind.Video) {
            setHostVideo(track as RemoteVideoTrack);
          }
        };
        const onUnsub = (
          track: RemoteTrack,
          _pub: RemoteTrackPublication,
          participant: RemoteParticipant,
        ): void => {
          if (participant?.isAgent && track.kind === Track.Kind.Audio) {
            setAgentAudio((current) => (current === track ? null : current));
          } else if (isInterviewer(participant) && track.kind === Track.Kind.Video) {
            setHostVideo((current) => (current === track ? null : current));
          }
        };
        const refreshAgent = (): void => {
          const present = Array.from(room.remoteParticipants.values()).some((p) => p.isAgent);
          setAgentPresent(present);
          if (present) setHasAgentAppeared(true);
        };

        room.on(RoomEvent.TrackSubscribed, onSub);
        room.on(RoomEvent.TrackUnsubscribed, onUnsub);
        room.on(RoomEvent.ParticipantConnected, refreshAgent);
        room.on(RoomEvent.ParticipantDisconnected, refreshAgent);

        // Sweep participants/tracks that subscribed before listeners attached.
        for (const participant of room.remoteParticipants.values()) {
          for (const pub of participant.trackPublications.values()) {
            if (pub.track) onSub(pub.track as RemoteTrack, pub, participant);
          }
        }
        refreshAgent();
      })
      .catch(() => setStatus("ended"));
    return () => {
      cancelled = true;
      void connRef.current?.disconnect();
    };
  }, [join]);

  useEffect(() => {
    if (selfVideoRef.current) {
      selfVideoRef.current.srcObject = selfStream;
    }
  }, [selfStream]);

  useEffect(() => {
    const video = hostVideoRef.current;
    if (!video || !hostVideo) {
      return;
    }
    hostVideo.attach(video);
    return () => {
      hostVideo.detach(video);
    };
  }, [hostVideo]);

  const toggleMic = useCallback((): void => {
    const room = connRef.current?.room;
    if (!room) return;
    const next = !micOn;
    void room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback((): void => {
    const room = connRef.current?.room;
    if (!room) return;
    const next = !camOn;
    void room.localParticipant.setCameraEnabled(next);
    setCamOn(next);
  }, [camOn]);

  const enableAudio = useCallback((): void => {
    void connRef.current?.startAudio().then(() => setNeedsAudioGesture(false));
  }, []);

  const end = useCallback((): void => {
    void connRef.current?.disconnect();
    setStatus("ended");
    onComplete();
  }, [onComplete]);

  if (status === "ended") {
    return (
      <main style={styles.centered}>
        <div style={{ textAlign: "center" }}>
          <div style={styles.endBadge}>
            <PhoneIcon />
          </div>
          <h2 style={{ marginTop: 20, fontWeight: 400, fontSize: 28 }}>You left the interview.</h2>
        </div>
      </main>
    );
  }

  const showAgentTile = hasAgentAppeared;
  const tileCount = 1 + (showAgentTile ? 1 : 0) + 1; // host + agent + self

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <span style={{ fontWeight: 500 }}>{join.room || "Puddle interview"}</span>
        <span style={styles.badge}>{status === "live" ? "Live" : "Connecting…"}</span>
      </header>

      {needsAudioGesture && (
        <button aria-label="enable-audio" onClick={enableAudio} style={styles.enableAudio}>
          Tap to enable audio
        </button>
      )}

      <section
        style={{
          ...styles.grid,
          gridTemplateColumns: `repeat(${tileCount}, minmax(0, 1fr))`,
        }}
      >
        <Tile label="Interviewer">
          <video ref={hostVideoRef} autoPlay playsInline style={styles.video(hostVideo !== null)} />
          {hostVideo === null && (
            <Placeholder initial="P" sub="Interviewer is monitoring" tint={COLORS.grey} />
          )}
        </Tile>

        {showAgentTile && <AgentTile active={agentPresent} audioTrack={agentAudio} />}

        <Tile label="You">
          <video
            ref={selfVideoRef}
            autoPlay
            muted
            playsInline
            style={{ ...styles.video(camOn), transform: "scaleX(-1)" }}
          />
          {!camOn && <Placeholder initial="You" sub="Camera is off" tint={COLORS.grey} />}
        </Tile>
      </section>

      <footer style={styles.footer}>
        <ControlButton label={micOn ? "Mute" : "Unmute"} active={micOn} onClick={toggleMic}>
          <MicIcon muted={!micOn} />
        </ControlButton>
        <ControlButton label={camOn ? "Camera off" : "Camera on"} active={camOn} onClick={toggleCam}>
          <CameraIcon disabled={!camOn} />
        </ControlButton>
        <button aria-label="Leave interview" title="Leave interview" onClick={end} style={styles.leave}>
          <PhoneIcon />
        </button>
      </footer>
    </main>
  );
}

function Tile({ label, children }: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <div style={styles.tile}>
      {children}
      <div style={styles.tileLabel}>{label}</div>
    </div>
  );
}

function Placeholder({
  initial,
  sub,
  tint,
}: {
  readonly initial: string;
  readonly sub: string;
  readonly tint: string;
}): JSX.Element {
  return (
    <div style={styles.placeholder}>
      <div style={{ ...styles.avatar, background: tint }}>{initial}</div>
      <div style={{ marginTop: 16, color: COLORS.sub, fontSize: 14 }}>{sub}</div>
    </div>
  );
}

function AgentTile({
  active,
  audioTrack,
}: {
  readonly active: boolean;
  readonly audioTrack: RemoteAudioTrack | null;
}): JSX.Element {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const bars = barRefs.current.filter((el): el is HTMLSpanElement => el !== null);
    if (bars.length === 0) return;

    if (!active || !audioTrack) {
      bars.forEach((el) => {
        el.style.transform = "scaleY(0.18)";
      });
      return;
    }

    let raf = 0;
    let stop: (() => void) | undefined;
    let analyser: AnalyserNode;
    try {
      const created = createAudioAnalyser(audioTrack, { cloneTrack: true, smoothingTimeConstant: 0.65 });
      analyser = created.analyser;
      analyser.fftSize = 128;
      stop = () => void created.cleanup();
      const ctx = analyser.context as AudioContext;
      if (ctx.state === "suspended") void ctx.resume();
    } catch {
      return;
    }
    const data = new Uint8Array(analyser.frequencyBinCount);
    const binFor = bars.map((_, i) => 2 + i * 2);
    const loop = (): void => {
      analyser.getByteFrequencyData(data);
      bars.forEach((el, i) => {
        const level = Math.min(1, (data[binFor[i] ?? 0] ?? 0) / 170);
        el.style.transform = `scaleY(${0.16 + level * 0.84})`;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      stop?.();
    };
  }, [active, audioTrack]);

  return (
    <div style={{ ...styles.tile, background: COLORS.agentTile }}>
      <div style={styles.agentCenter}>
        <div style={{ ...styles.agentRing, boxShadow: active ? `0 0 0 4px ${COLORS.accent}55` : `0 0 0 4px ${COLORS.grey}` }}>
          <img
            src={PUDDLE_SYMBOL}
            alt="Puddle AI interviewer"
            style={{ width: 56, height: 56, opacity: active ? 1 : 0.4 }}
          />
        </div>
        <div style={styles.bars}>
          {AGENT_WAVE_BARS.map((_, index) => (
            <span
              key={index}
              ref={(el) => {
                barRefs.current[index] = el;
              }}
              style={{
                width: 6,
                height: "100%",
                borderRadius: 999,
                transformOrigin: "bottom",
                transform: "scaleY(0.18)",
                background: active ? COLORS.accent : "#5f6368",
                transition: "transform 80ms linear",
              }}
            />
          ))}
        </div>
        <div style={{ marginTop: 16, fontSize: 18, fontWeight: 500 }}>Puddle AI</div>
        <div style={{ marginTop: 4, color: COLORS.sub, fontSize: 14 }}>
          {active ? "Interviewing" : "Paused"}
        </div>
      </div>
      <div style={styles.tileLabel}>Puddle AI</div>
      {!active && (
        <div style={styles.deafenBadge}>
          <DeafenIcon />
          Paused
        </div>
      )}
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
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ ...styles.control, background: active ? COLORS.grey : COLORS.red }}
    >
      {children}
    </button>
  );
}

function MicIcon({ muted }: { readonly muted: boolean }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
      {muted ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function CameraIcon({ disabled }: { readonly disabled: boolean }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 10 20 7v10l-5-3" />
      <rect x="3" y="6" width="12" height="12" rx="2" />
      {disabled ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function PhoneIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7.5 14.5a9 9 0 0 1 9 0" />
      <path d="M6 15.5 4.5 17a2 2 0 0 0 0 2.8l.2.2a2 2 0 0 0 2.8 0L9 18.5a2 2 0 0 0 .4-2.2" />
      <path d="M15 18.5 16.5 20a2 2 0 0 0 2.8 0l.2-.2a2 2 0 0 0 0-2.8L18 15.5a2 2 0 0 0-3 .8" />
    </svg>
  );
}

function DeafenIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m16 9 6 6" />
      <path d="m22 9-6 6" />
    </svg>
  );
}

const styles = {
  shell: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minHeight: "100svh",
    background: COLORS.bg,
    color: COLORS.text,
    fontFamily: "system-ui, -apple-system, sans-serif",
  } as CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    fontSize: 14,
  } as CSSProperties,
  badge: {
    borderRadius: 999,
    background: "#2b2c2f",
    color: COLORS.text,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 500,
  } as CSSProperties,
  enableAudio: {
    margin: "0 auto 8px",
    borderRadius: 999,
    border: "none",
    background: COLORS.accent,
    color: "#202124",
    padding: "10px 18px",
    fontWeight: 600,
    cursor: "pointer",
  } as CSSProperties,
  grid: {
    flex: 1,
    display: "grid",
    gap: 12,
    padding: "8px 20px 24px",
    maxWidth: 1500,
    width: "100%",
    margin: "0 auto",
    alignItems: "stretch",
  } as CSSProperties,
  tile: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 16,
    background: COLORS.tile,
    minHeight: 280,
    boxShadow: "0 16px 44px rgba(0,0,0,0.35)",
  } as CSSProperties,
  video: (visible: boolean): CSSProperties => ({
    width: "100%",
    height: "100%",
    objectFit: "cover",
    opacity: visible ? 1 : 0,
    transition: "opacity 200ms",
  }),
  tileLabel: {
    position: "absolute",
    bottom: 14,
    left: 14,
    borderRadius: 8,
    background: "rgba(0,0,0,0.6)",
    padding: "6px 12px",
    fontSize: 14,
    fontWeight: 500,
  } as CSSProperties,
  placeholder: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    textAlign: "center",
  } as CSSProperties,
  avatar: {
    display: "grid",
    placeItems: "center",
    width: 96,
    height: 96,
    borderRadius: "50%",
    fontSize: 28,
    fontWeight: 500,
  } as CSSProperties,
  agentCenter: {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
  } as CSSProperties,
  agentRing: {
    display: "grid",
    placeItems: "center",
    width: 112,
    height: 112,
    borderRadius: "50%",
    background: "#16305c",
  } as CSSProperties,
  bars: {
    marginTop: 20,
    height: 36,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 6,
  } as CSSProperties,
  deafenBadge: {
    position: "absolute",
    top: 14,
    right: 14,
    display: "flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    background: COLORS.red,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
  } as CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: "16px 20px",
  } as CSSProperties,
  control: {
    display: "grid",
    placeItems: "center",
    width: 48,
    height: 48,
    borderRadius: "50%",
    border: "none",
    color: "#fff",
    cursor: "pointer",
  } as CSSProperties,
  leave: {
    display: "grid",
    placeItems: "center",
    width: 72,
    height: 48,
    borderRadius: 999,
    border: "none",
    background: COLORS.red,
    color: "#fff",
    cursor: "pointer",
  } as CSSProperties,
  centered: {
    display: "grid",
    placeItems: "center",
    minHeight: "100svh",
    background: COLORS.bg,
    color: COLORS.text,
    fontFamily: "system-ui, -apple-system, sans-serif",
  } as CSSProperties,
  endBadge: {
    display: "grid",
    placeItems: "center",
    width: 56,
    height: 56,
    margin: "0 auto",
    borderRadius: "50%",
    background: "#3c1f1d",
    color: COLORS.red,
  } as CSSProperties,
} satisfies Record<string, unknown>;
