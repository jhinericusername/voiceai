#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-851725544921}"
REGION="${REGION:-us-west-1}"
CERT_ARN="${CERT_ARN:-arn:aws:acm:us-west-1:851725544921:certificate/c84bf5ed-cfff-4fe9-9d05-8887d1f71711}"
PLATFORM_DOMAIN_NAME="${PLATFORM_DOMAIN_NAME:-app.usepuddle.com}"

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

REQUESTED_ENABLE_LIVEKIT_RECORDINGS="${ENABLE_LIVEKIT_RECORDINGS:-true}"
ALLOW_RECORDINGS_DISABLED_DEPLOY="${ALLOW_RECORDINGS_DISABLED_DEPLOY:-false}"
if [[ "$ALLOW_RECORDINGS_DISABLED_DEPLOY" == "true" ]]; then
  ENABLE_LIVEKIT_RECORDINGS="$REQUESTED_ENABLE_LIVEKIT_RECORDINGS"
else
  if [[ "$REQUESTED_ENABLE_LIVEKIT_RECORDINGS" != "true" ]]; then
    echo "Ignoring ENABLE_LIVEKIT_RECORDINGS=$REQUESTED_ENABLE_LIVEKIT_RECORDINGS; recording artifacts are required for the dashboard." >&2
    echo "Set ALLOW_RECORDINGS_DISABLED_DEPLOY=true only for an intentional no-recording deploy." >&2
  fi
  ENABLE_LIVEKIT_RECORDINGS="true"
fi
ARTIFACTS_BUCKET_NAME="${PUDDLE_ARTIFACTS_BUCKET:-puddle-videoagent-artifacts-$AWS_ACCOUNT_ID-$REGION}"
PARTICIPANT_RECONNECT_GRACE_SECONDS="${PARTICIPANT_RECONNECT_GRACE_SECONDS:-${PUDDLE_PARTICIPANT_RECONNECT_GRACE_SECONDS:-300}}"
export PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS="${PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS:-${PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS:-}}"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/arm64}"

if [[ -z "${LIVEKIT_URL:-}" ]]; then
  echo "LIVEKIT_URL is required. Add it to .env.local or export it before running." >&2
  exit 1
fi

GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
BUILD_STAMP="$(date +%Y%m%d%H%M)"
BACKEND_IMAGE_TAG="${BACKEND_IMAGE_TAG:-$GIT_SHA-backend-$BUILD_STAMP}"
PLATFORM_TAG="${PLATFORM_TAG:-$GIT_SHA-platform-$BUILD_STAMP}"
AGENT_IMAGE_TAG="${AGENT_IMAGE_TAG:-$GIT_SHA-agent-$BUILD_STAMP}"
BACKEND_REPO="${BACKEND_REPO:-$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/puddle-videoagent-backend}"
PLATFORM_REPO="${PLATFORM_REPO:-$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/puddle-videoagent-platform}"
AGENT_REPO="${AGENT_REPO:-$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/puddle-videoagent-agent}"

echo "Deploying platform stack images:"
echo "  backend repo:  $BACKEND_REPO"
echo "  backend tag:   $BACKEND_IMAGE_TAG"
echo "  platform repo: $PLATFORM_REPO"
echo "  platform tag:  $PLATFORM_TAG"
echo "  agent repo:    $AGENT_REPO"
echo "  agent tag:     $AGENT_IMAGE_TAG"
echo "  platform url:  https://$PLATFORM_DOMAIN_NAME"
echo "  recordings:    $ENABLE_LIVEKIT_RECORDINGS"
echo "  artifacts:     $ARTIFACTS_BUCKET_NAME"
echo "  reconnect:     ${PARTICIPANT_RECONNECT_GRACE_SECONDS}s"
echo "  ashby admins:  $([[ -n "$PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS" ]] && echo configured || echo unset)"
echo "  docker target: $DOCKER_PLATFORM"

CDK_CONTEXT_ARGS=(
  -c envName=dev
  -c region="$REGION"
  -c account="$AWS_ACCOUNT_ID"
  -c deployBackendService=true
  -c backendImageTag="$BACKEND_IMAGE_TAG"
  -c liveKitUrl="$LIVEKIT_URL"
  -c enableLiveKitRecordings="$ENABLE_LIVEKIT_RECORDINGS"
  -c platformHosting=container
  -c platformImageTag="$PLATFORM_TAG"
  -c platformDomainName="$PLATFORM_DOMAIN_NAME"
  -c platformCertificateArn="$CERT_ARN"
  -c deployAgentService=true
  -c agentImageTag="$AGENT_IMAGE_TAG"
  -c participantReconnectGraceSeconds="$PARTICIPANT_RECONNECT_GRACE_SECONDS"
)

if [[ -n "${LIVEKIT_EGRESS_ASSUME_ROLE_ARN:-}" ]]; then
  CDK_CONTEXT_ARGS+=(
    -c liveKitEgressAssumeRoleArn="$LIVEKIT_EGRESS_ASSUME_ROLE_ARN"
  )
fi

if [[ -n "${LIVEKIT_EGRESS_ASSUME_ROLE_EXTERNAL_ID:-}" ]]; then
  CDK_CONTEXT_ARGS+=(
    -c liveKitEgressAssumeRoleExternalId="$LIVEKIT_EGRESS_ASSUME_ROLE_EXTERNAL_ID"
  )
fi

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

docker build --platform "$DOCKER_PLATFORM" -f "$ROOT_DIR/backend/Dockerfile" -t "$BACKEND_REPO:$BACKEND_IMAGE_TAG" "$ROOT_DIR"
docker push "$BACKEND_REPO:$BACKEND_IMAGE_TAG"

docker build --platform "$DOCKER_PLATFORM" -f "$ROOT_DIR/platform/Dockerfile" -t "$PLATFORM_REPO:$PLATFORM_TAG" "$ROOT_DIR"
docker push "$PLATFORM_REPO:$PLATFORM_TAG"

docker build --platform "$DOCKER_PLATFORM" -f "$ROOT_DIR/agent/Dockerfile" -t "$AGENT_REPO:$AGENT_IMAGE_TAG" "$ROOT_DIR"
docker push "$AGENT_REPO:$AGENT_IMAGE_TAG"

cd "$ROOT_DIR/infra"
npm run cdk -- deploy --all --require-approval never "${CDK_CONTEXT_ARGS[@]}"
