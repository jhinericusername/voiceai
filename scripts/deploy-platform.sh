#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-851725544921}"
REGION="${REGION:-us-west-1}"
CERT_ARN="${CERT_ARN:-arn:aws:acm:us-west-1:851725544921:certificate/c84bf5ed-cfff-4fe9-9d05-8887d1f71711}"
BACKEND_IMAGE_TAG="${BACKEND_IMAGE_TAG:-23b88a7-rds-ssl-migrations}"
PLATFORM_DOMAIN_NAME="${PLATFORM_DOMAIN_NAME:-app.usepuddle.com}"

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

if [[ -z "${LIVEKIT_URL:-}" ]]; then
  echo "LIVEKIT_URL is required. Add it to .env.local or export it before running." >&2
  exit 1
fi

PLATFORM_TAG="${PLATFORM_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)-platform-$(date +%Y%m%d%H%M)}"
PLATFORM_REPO="${PLATFORM_REPO:-$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/puddle-videoagent-platform}"

echo "Deploying platform image:"
echo "  repo: $PLATFORM_REPO"
echo "  tag:  $PLATFORM_TAG"
echo "  url:  https://$PLATFORM_DOMAIN_NAME"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

docker build -f "$ROOT_DIR/platform/Dockerfile" -t "$PLATFORM_REPO:$PLATFORM_TAG" "$ROOT_DIR"
docker push "$PLATFORM_REPO:$PLATFORM_TAG"

cd "$ROOT_DIR/infra"
npm run cdk -- deploy \
  -c envName=dev \
  -c region="$REGION" \
  -c account="$AWS_ACCOUNT_ID" \
  -c deployBackendService=true \
  -c backendImageTag="$BACKEND_IMAGE_TAG" \
  -c liveKitUrl="$LIVEKIT_URL" \
  -c platformHosting=container \
  -c platformImageTag="$PLATFORM_TAG" \
  -c platformDomainName="$PLATFORM_DOMAIN_NAME" \
  -c platformCertificateArn="$CERT_ARN"
