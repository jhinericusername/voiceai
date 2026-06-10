import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { isCandidateReady } from "./readiness.js";

export interface RoomConnection {
  readonly room: Room;
  startAudio: () => Promise<void>;
  disconnect: () => Promise<void>;
}

// Connects to the interview room: publishes mic + camera, attaches the agent's
// audio, and signals "ready" to the agent only once the candidate can both be
// heard (mic published) and hear the agent (browser autoplay unblocked). The
// worker waits for that signal before speaking the opener.
export async function connectToInterview(
  wsUrl: string,
  token: string,
  onAgentAudio: (el: HTMLAudioElement) => void,
  onSelfVideo: (track: MediaStreamTrack) => void,
  onAudioPlaybackChanged?: (canPlayback: boolean) => void,
): Promise<RoomConnection> {
  const room = new Room({ adaptiveStream: true, dynacast: true });

  let micPublished = false;
  const signalReadyIfPossible = (): void => {
    if (isCandidateReady(micPublished, room.canPlaybackAudio)) {
      void room.localParticipant.setAttributes({ ready: "true" });
    }
  };

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach() as HTMLAudioElement;
      onAgentAudio(el);
    }
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    onAudioPlaybackChanged?.(room.canPlaybackAudio);
    signalReadyIfPossible();
  });

  await room.connect(wsUrl, token);

  await room.localParticipant.setMicrophoneEnabled(true);
  await room.localParticipant.setCameraEnabled(true);
  micPublished = room.localParticipant
    .getTrackPublications()
    .some((p) => p.kind === Track.Kind.Audio);

  const camPub = room.localParticipant
    .getTrackPublications()
    .find((p) => p.kind === Track.Kind.Video);
  if (camPub?.track) {
    onSelfVideo(camPub.track.mediaStreamTrack);
  }

  onAudioPlaybackChanged?.(room.canPlaybackAudio);
  signalReadyIfPossible();

  return {
    room,
    startAudio: async () => {
      await room.startAudio();
      signalReadyIfPossible();
    },
    disconnect: () => room.disconnect(),
  };
}
