interface LandingProps {
  readonly onContinue: (token: string) => void;
}

// Light identity check — name/email/token; no mic or camera access yet.
export function Landing({ onContinue }: LandingProps): JSX.Element {
  return (
    <main>
      <h1>Welcome to your Puddle interview</h1>
      <p>Enter the access token from your invitation email to begin.</p>
      <button onClick={() => onContinue("token-from-input")}>Continue</button>
    </main>
  );
}
