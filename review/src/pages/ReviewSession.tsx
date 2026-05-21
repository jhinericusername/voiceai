import { useState } from "react";
import {
  applyScoreEdit,
  buildSignoffRecord,
  validateSignoff,
  type ReviewedAssessment,
} from "../signoff.js";

interface ReviewSessionProps {
  readonly assessment: ReviewedAssessment;
  readonly compositeVideoUrl: string;
  readonly onSignedOff: (reviewerEmail: string) => void;
}

// Per session: VOD playback, question-aligned transcript, per-category
// score + evidence + confidence, integrity flags, and the reviewer sign-off.
export function ReviewSession({
  assessment,
  compositeVideoUrl,
  onSignedOff,
}: ReviewSessionProps): JSX.Element {
  const [current, setCurrent] = useState<ReviewedAssessment>(assessment);
  const [reviewerEmail, setReviewerEmail] = useState("");

  const signOff = (): void => {
    const validation = validateSignoff(current, { reviewerEmail });
    if (!validation.ok) return;
    buildSignoffRecord(current, {
      reviewerEmail,
      signedOffAt: new Date().toISOString(),
    });
    onSignedOff(reviewerEmail);
  };

  return (
    <main>
      <video aria-label="composite-vod" src={compositeVideoUrl} controls />
      <section aria-label="integrity-flags">
        {current.integrityFlags.length === 0
          ? "No integrity flags"
          : current.integrityFlags.join(", ")}
      </section>
      <section aria-label="category-scores">
        {current.categoryScores.map((cs) => (
          <div key={cs.category}>
            <span>{cs.category}</span>
            <span>{cs.score}</span>
            {cs.lowConfidence && <span aria-label="low-confidence">low confidence</span>}
            <button onClick={() => setCurrent(applyScoreEdit(current, cs.category, 4))}>
              Set 4
            </button>
          </div>
        ))}
      </section>
      <input
        aria-label="reviewer-email"
        value={reviewerEmail}
        onChange={(e) => setReviewerEmail(e.target.value)}
      />
      <button onClick={signOff}>Sign off</button>
    </main>
  );
}
