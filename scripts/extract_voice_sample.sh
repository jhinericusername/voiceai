#!/usr/bin/env bash
# Extract a 30-second mono WAV clip from an S3 video for Cartesia Instant Voice Clone.
#
# Usage:
#   scripts/extract_voice_sample.sh <s3-uri-or-local-path> <start-seconds> [duration-seconds] [output-path]
#
# Examples:
#   scripts/extract_voice_sample.sh s3://puddle-corpus/prakul-interview-01.mp4 45
#   scripts/extract_voice_sample.sh ./local-video.mp4 120 30 ./voice-sample.wav
#
# Picks a 30s window where Prakul is the only speaker. Avoid music, laughter,
# overlapping speech. Mono 22050 Hz WAV is Cartesia's recommended sample format.

set -euo pipefail

SRC="${1:?source video required (s3:// URI or local path)}"
START="${2:?start time in seconds required}"
DURATION="${3:-30}"
OUT="${4:-voice-sample.wav}"

if [[ "$SRC" == s3://* ]]; then
  TMP="$(mktemp -t voice-sample.XXXXXX.mp4)"
  trap 'rm -f "$TMP"' EXIT
  echo "Downloading $SRC -> $TMP"
  aws s3 cp "$SRC" "$TMP"
  SRC="$TMP"
fi

echo "Extracting ${DURATION}s starting at ${START}s -> $OUT"
ffmpeg -y -ss "$START" -t "$DURATION" -i "$SRC" \
  -vn -ac 1 -ar 22050 -acodec pcm_s16le "$OUT"

echo ""
echo "Done: $OUT"
echo ""
echo "Next steps:"
echo "  1. Listen: afplay '$OUT'   (macOS)  /  aplay '$OUT'   (Linux)"
echo "  2. Confirm: only Prakul, no music, clear speech, no overlap"
echo "  3. Upload to Cartesia dashboard -> Voices -> + Add Voice -> Instant Clone"
echo "  4. Copy the voice ID -> .env  CARTESIA_VOICE_ID=<id>"
