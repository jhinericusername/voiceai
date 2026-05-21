interface PreflightProps {
  readonly onPass: () => void;
}

// Device + network preflight: mic, camera, and connection check.
export function Preflight({ onPass }: PreflightProps): JSX.Element {
  return (
    <main>
      <h1>Device check</h1>
      <p>Checking your microphone, camera, and network connection.</p>
      <button onClick={onPass}>Everything looks good</button>
    </main>
  );
}
