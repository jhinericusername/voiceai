interface WaitingRoomProps {
  readonly onInterviewerReady: () => void;
}

// Waiting room until the scheduled start; the agent worker joins the room.
export function WaitingRoom({ onInterviewerReady }: WaitingRoomProps): JSX.Element {
  return (
    <main>
      <h1>Waiting room</h1>
      <p>Your interviewer will join shortly. Please stay on this page.</p>
      <button onClick={onInterviewerReady}>Join interview</button>
    </main>
  );
}
