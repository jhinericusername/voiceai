interface InCallProps {
  readonly remainingSeconds: number;
  readonly onComplete: () => void;
}

// In-call UI: agent shown as a simple visual, candidate self-view, timer.
export function InCall({ remainingSeconds, onComplete }: InCallProps): JSX.Element {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.floor(remainingSeconds % 60);
  return (
    <main>
      <div aria-label="interviewer">Puddle interviewer</div>
      <video aria-label="self-view" autoPlay muted playsInline />
      <div aria-label="timer">
        {minutes}:{String(seconds).padStart(2, "0")}
      </div>
      <button onClick={onComplete}>End interview</button>
    </main>
  );
}
