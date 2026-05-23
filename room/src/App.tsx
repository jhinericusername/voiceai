import { useState } from "react";
import { ROOM_STEPS, nextStep, type RoomStep } from "./flow.js";
import { Landing } from "./pages/Landing.js";
import { Consent } from "./pages/Consent.js";
import { Preflight } from "./pages/Preflight.js";
import { WaitingRoom } from "./pages/WaitingRoom.js";
import { InCall } from "./pages/InCall.js";
import { Completion } from "./pages/Completion.js";
import { createSession, type JoinDetails } from "./session.js";

const backendUrl = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://localhost:8080";

export function App(): JSX.Element {
  const [step, setStep] = useState<RoomStep>(ROOM_STEPS[0]);
  const [join, setJoin] = useState<JoinDetails | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const advance = (): void => setStep((s) => nextStep(s));

  // Triggered by WaitingRoom's "Join interview" button: create the session,
  // then advance to InCall. Dev-default candidate metadata is used here;
  // swap in real per-candidate values once the flow collects them.
  const startInterview = async (): Promise<void> => {
    setSessionError(null);
    setCreatingSession(true);
    try {
      const details = await createSession(backendUrl, {
        orgId: "dev-org",
        candidateEmail: "candidate@example.com",
        scriptVersion: "pilot-v1",
        scheduledAt: new Date().toISOString(),
      });
      setJoin(details);
      advance();
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingSession(false);
    }
  };

  switch (step) {
    case "landing":
      return <Landing onContinue={() => advance()} />;
    case "consent":
      return <Consent onConsent={advance} />;
    case "preflight":
      return <Preflight onPass={advance} />;
    case "waiting":
      return (
        <main>
          <WaitingRoom onInterviewerReady={() => void startInterview()} />
          {creatingSession ? <div aria-label="session-status">Creating session…</div> : null}
          {sessionError ? (
            <div role="alert" aria-label="session-error">
              Could not start interview: {sessionError}
            </div>
          ) : null}
        </main>
      );
    case "incall":
      if (!join) {
        return (
          <main>
            <div role="alert" aria-label="session-error">
              Missing session details. Please refresh and try again.
            </div>
          </main>
        );
      }
      return <InCall join={join} onComplete={advance} />;
    case "completion":
      return <Completion />;
  }
}
