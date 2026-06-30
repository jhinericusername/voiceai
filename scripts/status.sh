#!/usr/bin/env bash
set -euo pipefail

REGION="${REGION:-us-west-1}"
CLUSTER="${CLUSTER:-puddle-videoagent-cluster}"
PLATFORM_URL="${PLATFORM_URL:-https://app.usepuddle.com}"
SINCE="${SINCE:-60m}"

SERVICES=(
  "puddle-videoagent-platform-service"
  "puddle-videoagent-backend-service"
  "puddle-videoagent-agent-service"
)
SERVICE_CONTAINERS=(
  "platform"
  "backend"
  "agent"
)

section() {
  printf '\n== %s ==\n' "$1"
}

section "ECS services"
aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services "${SERVICES[@]}" \
  --region "$REGION" \
  --query 'services[*].{Service:serviceName,Status:status,Desired:desiredCount,Running:runningCount,Pending:pendingCount,Rollout:deployments[0].rolloutState,TaskDefinition:taskDefinition}' \
  --output table

section "Runtime task settings"
echo "Container environment values and secret references from the active ECS task definitions. Secret values are not fetched."
echo "For recording, verify backend has PUDDLE_RECORDINGS_ENABLED=true, PUDDLE_ARTIFACTS_BUCKET, PUDDLE_ARTIFACTS_REGION, PUDDLE_LIVEKIT_WEBHOOK_URL, PUDDLE_EGRESS_S3_ACCESS_KEY_ID, and PUDDLE_EGRESS_S3_SECRET_ACCESS_KEY."
for i in "${!SERVICES[@]}"; do
  service="${SERVICES[$i]}"
  container="${SERVICE_CONTAINERS[$i]}"
  task_definition="$(
    aws ecs describe-services \
      --cluster "$CLUSTER" \
      --services "$service" \
      --region "$REGION" \
      --query 'services[0].taskDefinition' \
      --output text
  )"

  if [[ -z "$task_definition" || "$task_definition" == "None" ]]; then
    echo "No active task definition found for $service."
    continue
  fi

  printf '\n-- %s / %s --\n' "$service" "$container"
  aws ecs describe-task-definition \
    --task-definition "$task_definition" \
    --region "$REGION" \
    --query "taskDefinition.{Family:family,Revision:revision,TaskDefinitionArn:taskDefinitionArn,Container:containerDefinitions[?name=='$container']|[0].{Image:image,Environment:sort_by(environment,&name),Secrets:sort_by(secrets[].{Name:name,ValueFrom:valueFrom},&Name)}}" \
    --output json
done

section "Load balancers"
aws elbv2 describe-load-balancers \
  --region "$REGION" \
  --query "LoadBalancers[?contains(LoadBalancerName, 'Puddle-Backe') || contains(LoadBalancerName, 'Puddle-Platf')].{Name:LoadBalancerName,Scheme:Scheme,State:State.Code,DNS:DNSName}" \
  --output table

section "Public platform"
if command -v curl >/dev/null 2>&1; then
  curl -fsS -o /dev/null -w "GET $PLATFORM_URL -> HTTP %{http_code} in %{time_total}s\n" "$PLATFORM_URL"
else
  echo "curl is not installed; skipping public platform check."
fi

section "Recent agent registration"
agent_registration="$(
  aws logs tail /aws/ecs/puddle-videoagent/agent \
    --since "$SINCE" \
    --region "$REGION" \
    --format short \
    --filter-pattern '"registered worker"' || true
)"

if [[ -n "$agent_registration" ]]; then
  printf '%s\n' "$agent_registration"
else
  echo "No worker registration log in the last $SINCE. Check ECS service state above and increase SINCE if needed."
fi

section "Recent backend errors"
backend_errors="$(
  aws logs tail /aws/ecs/puddle-videoagent/backend \
    --since "$SINCE" \
    --region "$REGION" \
    --format short \
    --filter-pattern '"level\":50"' || true
)"

if [[ -n "$backend_errors" ]]; then
  printf '%s\n' "$backend_errors"
else
  echo "No backend level=50 errors in the last $SINCE."
fi
