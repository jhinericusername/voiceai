import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";

export interface RoomConnection {
  readonly room: Room;
  disconnect: () => Promise<void>;
}

// Connects to the interview room: publishes mic + camera, attaches the
// agent's audio so the candidate hears it. Returns the live Room handle.
export async function connectToInterview(
  wsUrl: string,
  token: string,
  onAgentAudio: (el: HTMLAudioElement) => void,
  onSelfVideo: (track: MediaStreamTrack) => void,
): Promise<RoomConnection> {
  const room = new Room({ adaptiveStream: true, dynacast: true });

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach() as HTMLAudioElement;
      onAgentAudio(el);
    }
  });

  await room.connect(wsUrl, token);
  await room.localParticipant.setMicrophoneEnabled(true);
  await room.localParticipant.setCameraEnabled(true);

  const camPub = room.localParticipant
    .getTrackPublications()
    .find((p) => p.kind === Track.Kind.Video);
  if (camPub?.track) {
    onSelfVideo(camPub.track.mediaStreamTrack);
  }

  return { room, disconnect: () => room.disconnect() };
}
