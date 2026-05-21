interface ConsentProps {
  readonly onConsent: () => void;
}

// AI disclosure + recording consent captured BEFORE any mic/camera access.
export function Consent({ onConsent }: ConsentProps): JSX.Element {
  return (
    <main>
      <h1>Before we begin</h1>
      <p>
        This interview is conducted by an AI interviewer. Audio and video are
        recorded and processed for integrity checks. Video is never used to
        score you. You may request deletion of your data at any time.
      </p>
      <button onClick={onConsent}>I understand and consent</button>
    </main>
  );
}
