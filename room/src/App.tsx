import { useState } from "react";
import { ROOM_STEPS, nextStep, type RoomStep } from "./flow.js";
import { Landing } from "./pages/Landing.js";
import { Consent } from "./pages/Consent.js";
import { Preflight } from "./pages/Preflight.js";
import { WaitingRoom } from "./pages/WaitingRoom.js";
import { InCall } from "./pages/InCall.js";
import { Completion } from "./pages/Completion.js";

export function App(): JSX.Element {
  const [step, setStep] = useState<RoomStep>(ROOM_STEPS[0]);
  const advance = (): void => setStep((s) => nextStep(s));

  switch (step) {
    case "landing":
      return <Landing onContinue={() => advance()} />;
    case "consent":
      return <Consent onConsent={advance} />;
    case "preflight":
      return <Preflight onPass={advance} />;
    case "waiting":
      return <WaitingRoom onInterviewerReady={advance} />;
    case "incall":
      return <InCall remainingSeconds={1800} onComplete={advance} />;
    case "completion":
      return <Completion />;
  }
}
