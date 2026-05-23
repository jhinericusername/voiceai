import { useEffect, useRef, useState } from "react";
import { connectToInterview, type RoomConnection } from "../livekit.js";
import type { JoinDetails } from "../session.js";

interface InCallProps {
  readonly join: JoinDetails;
  readonly onComplete: () => void;
}

// In-call UI: connects to the LiveKit room, attaches agent audio, shows self-view.
export function InCall({ join, onComplete }: InCallProps): JSX.Element {
  const selfVideoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "ended">("connecting");
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

  const end = (): void => {
    void connRef.current?.disconnect();
    setStatus("ended");
    onComplete();
  };

  return (
    <main>
      <div aria-label="status">{status}</div>
      <video aria-label="self-view" ref={selfVideoRef} autoPlay muted playsInline />
      <button onClick={end}>End interview</button>
    </main>
  );
}
