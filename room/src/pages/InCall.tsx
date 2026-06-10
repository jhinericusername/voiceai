import { useEffect, useRef, useState } from "react";
import { connectToInterview, type RoomConnection } from "../livekit.js";
import type { JoinDetails } from "../session.js";

interface InCallProps {
  readonly join: JoinDetails;
  readonly onComplete: () => void;
}

// In-call UI: connects to the LiveKit room, attaches agent audio, shows self-view.
// Surfaces a "Tap to enable audio" affordance when the browser blocks autoplay,
// so the candidate can always hear the agent's opener.
export function InCall({ join, onComplete }: InCallProps): JSX.Element {
  const selfVideoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "ended">("connecting");
  const [needsAudioGesture, setNeedsAudioGesture] = useState(false);
  const connRef = useRef<RoomConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    connectToInterview(
      join.wsUrl,
      join.token,
      (audioEl) => document.body.appendChild(audioEl),
      (videoTrack) => {
        if (selfVideoRef.current) {
          selfVideoRef.current.srcObject = new MediaStream([videoTrack]);
        }
      },
      (canPlayback) => setNeedsAudioGesture(!canPlayback),
    )
      .then((conn) => {
        if (cancelled) {
          void conn.disconnect();
          return;
        }
        connRef.current = conn;
        setStatus("live");
      })
      .catch(() => setStatus("ended"));
    return () => {
      cancelled = true;
      void connRef.current?.disconnect();
    };
  }, [join]);

  const enableAudio = (): void => {
    void connRef.current?.startAudio().then(() => setNeedsAudioGesture(false));
  };

  const end = (): void => {
    void connRef.current?.disconnect();
    setStatus("ended");
    onComplete();
  };

  return (
    <main>
      <div aria-label="status">{status}</div>
      {needsAudioGesture && (
        <button aria-label="enable-audio" onClick={enableAudio}>
          Tap to enable audio
        </button>
      )}
      <video aria-label="self-view" ref={selfVideoRef} autoPlay muted playsInline />
      <button onClick={end}>End interview</button>
    </main>
  );
}
