import { ReviewSession } from "./pages/ReviewSession.js";
import type { ReviewedAssessment } from "./signoff.js";

// In v1 the assessment under review is supplied by the backend; this shell
// renders the single review surface.
const PLACEHOLDER: ReviewedAssessment = {
  sessionId: "",
  scriptVersion: "pilot-v1",
  categoryScores: [],
  meetsBareMinimum: false,
  integrityFlags: [],
};

export function App(): JSX.Element {
  return (
    <ReviewSession
      assessment={PLACEHOLDER}
      compositeVideoUrl=""
      onSignedOff={() => undefined}
    />
  );
}
