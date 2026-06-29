# Puddle Voice AI Infrastructure

AWS CDK app for the deployable foundation described in `infra.md`.

The default stack deploys the shared foundation resources:

- VPC with public ingress subnets, private app subnets, isolated data subnets, NAT egress, and an S3 gateway endpoint
- ECS cluster
- private RDS PostgreSQL instance in isolated subnets
- ECR repositories for `backend`, `agent`, and `platform`
- private S3 buckets for artifacts and web assets
- Secrets Manager runtime secret placeholders
- CloudWatch log groups
- ECS task/execution IAM roles
- baseline security groups
- stack outputs for the shared resource names and ARNs

The backend can be deployed as a private ECS/Fargate service behind an internal
ALB. The platform can be deployed as a public ECS/Fargate service behind a
public ALB while calling the backend through the internal ALB. The LiveKit
interviewer agent can be deployed as a private ECS/Fargate worker service with
no public listener. Public backend exposure remains blocked.

## Commands

```sh
npm run build
npm test
npm run cdk -- synth --no-lookups
```

Deploy the default dev foundation:

```sh
npm run cdk -- deploy -c envName=dev -c region=us-west-1
```

Deploy a stage/prod-shaped foundation:

```sh
npm run cdk -- deploy -c envName=stage -c region=us-west-1
npm run cdk -- deploy -c envName=prod -c region=us-west-1
```

If you want the stack bound to an explicit account during synth/deploy, pass
`-c account=<aws-account-id>`. In restricted local environments, prefer
`synth --no-lookups` without `account` so CDK does not attempt AWS context
lookups.

## Useful Context Flags

```text
envName=dev|stage|prod
region=us-west-1
account=<aws-account-id>
stackName=Puddle-VideoAgent-Infra
resourcePrefix=puddle-videoagent
maxAzs=2
natGateways=1
logRetentionDays=30
enableDevTunnel=true|false
devTunnelInstanceType=t3.nano

deployBackendService=false
exposeBackendPublicly=false
requireBackendAuth=true
backendImageTag=latest
backendDesiredCount=1
backendCpu=256
backendMemoryMiB=512
liveKitUrl=wss://...
enableLiveKitRecordings=true
liveKitEgressAssumeRoleArn=<optional-role-arn>
liveKitEgressAssumeRoleExternalId=<optional-external-id>

deployAgentService=false
agentImageTag=latest
agentDesiredCount=1
agentCpu=1024
agentMemoryMiB=2048

platformHosting=disabled|container|static-export
platformImageTag=latest
platformDesiredCount=1
platformCpu=512
platformMemoryMiB=1024
platformDomainName=app.usepuddle.com
platformCertificateArn=<acm-certificate-arn>
platformAllowedAuthDomains=usepuddle.com,workweave.ai
platformDefaultScriptVersion=pilot-v1

useExternalDatabase=false
databaseName=puddle
databaseUsername=puddle_app
databaseInstanceType=t4g.micro
databaseAllocatedStorageGb=20
databaseMaxAllocatedStorageGb=100
databaseBackupRetentionDays=7
databaseMultiAz=false
databaseDeletionProtection=false
allowRealCandidateDataOnExternalDatabase=false

enableGithubOidc=false
githubOwner=<owner>
githubRepo=<repo>
githubOidcProviderArn=<existing-provider-arn>
```

## Backend Deployment

Build and push a backend image to the stack-created ECR repo before enabling the
service:

```sh
AWS_ACCOUNT_ID=<account-id>
REGION=us-west-1
TAG=$(git rev-parse --short HEAD)
REPO="$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/puddle-videoagent-backend"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
docker build -f ../backend/Dockerfile -t "$REPO:$TAG" ..
docker push "$REPO:$TAG"

npm run cdk -- deploy \
  -c envName=dev \
  -c region="$REGION" \
  -c deployBackendService=true \
  -c backendDesiredCount=0 \
  -c backendImageTag="$TAG" \
  -c liveKitUrl=wss://your-livekit-host \
  -c enableLiveKitRecordings=true
```

Recording/dashboard persistence is required. With
`enableLiveKitRecordings=true`, CDK imports the existing LiveKit Cloud S3 egress
credential secret at `/puddle-videoagent/livekit/egress-s3-credentials`; backend
ECS tasks receive that secret as `PUDDLE_EGRESS_S3_ACCESS_KEY_ID` and
`PUDDLE_EGRESS_S3_SECRET_ACCESS_KEY`. The secret must contain `accessKeyId` and
`secretAccessKey` JSON fields for a least-privilege upload credential that can
write to the artifacts bucket. `liveKitEgressAssumeRoleArn` is optional and
should stay unset unless LiveKit enables AWS AssumeRole for S3 egress on the
account. Candidate joins should fail closed rather than proceed without
recording.

`scripts/deploy-platform.sh` passes `enableLiveKitRecordings=true` by default. It
also maps
`PUDDLE_PARTICIPANT_RECONNECT_GRACE_SECONDS` (default `300`) to the CDK
`participantReconnectGraceSeconds` context flag for the LiveKit agent service.
For Ashby bootstrap admins, it maps
`PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS` from `.env.local` or
`PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS` from the shell into the child CDK
process environment. Manual CDK runs should set
`PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS` in the shell environment; this value
is intentionally not accepted through CDK context so it does not appear in argv
or shell history.

After the service deploys, run migrations once with the emitted
`BackendMigrationTaskDefinitionArn` in the private app subnets using
`BackendTasksSecurityGroupId`. Then redeploy with `backendDesiredCount=1` to
start the backend service. The backend listener health check is `GET /healthz`;
it does not depend on Postgres or LiveKit.

Current dev backend internal URL, from the healthy deployed stack on May 27,
2026:

```text
http://internal-Puddle-Backe-B0GCD7ar4tZv-1590581178.us-west-1.elb.amazonaws.com
```

Treat this as stack-specific state. CDK wires the current
`BackendInternalBaseUrl` into the platform and agent ECS tasks automatically
when those services are enabled with the backend service.

## Connected Local Development

Dev stacks create a small private EC2 instance for AWS SSM port forwarding by
default. The instance has no SSH ingress and uses the
`AmazonSSMManagedInstanceCore` policy. CDK emits `DevTunnelInstanceId`; local
scripts use it to forward:

- local platform traffic to `BackendInternalBaseUrl`,
- local backend database traffic to the private RDS endpoint.

Disable it with `-c enableDevTunnel=false`. The tunnel target is blocked for
`envName=prod`.

## Agent Image Build

Build the LiveKit worker image from the repository root so Docker can include
both the Python package and `rubric/`:

```sh
AWS_ACCOUNT_ID=<account-id>
REGION=us-west-1
TAG=$(git rev-parse --short HEAD)
REPO="$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/puddle-videoagent-agent"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
docker build --platform linux/arm64 -f agent/Dockerfile -t "$REPO:$TAG" .
docker push "$REPO:$TAG"
```

The image command is `python -m agent.worker start`. The CDK stack already
creates the ECR repository, log group, task roles, and provider secret grants.
Deploy the private worker service after the image is pushed:

```sh
npm run cdk -- deploy \
  -c envName=dev \
  -c region="$REGION" \
  -c deployBackendService=true \
  -c backendImageTag="<backend-tag>" \
  -c liveKitUrl=wss://your-livekit-host \
  -c enableLiveKitRecordings=true \
  -c platformHosting=container \
  -c platformImageTag="<platform-tag>" \
  -c deployAgentService=true \
  -c agentImageTag="$TAG" \
  -c participantReconnectGraceSeconds=300
```

The agent service has no load balancer. It registers with LiveKit as
`puddle-interviewer`, waits for dispatches from the backend-created rooms, and
pulls runtime credentials from Secrets Manager.

## Platform Deployment

Populate these Secrets Manager values before starting the platform service:

```text
/puddle-videoagent/platform/workos-api-key
/puddle-videoagent/platform/workos-client-id
/puddle-videoagent/platform/auth-secret
/puddle-videoagent/backend/internal-token
```

Build and push a platform image to the stack-created ECR repo:

```sh
AWS_ACCOUNT_ID=<account-id>
REGION=us-west-1
TAG=$(git rev-parse --short HEAD)
REPO="$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/puddle-videoagent-platform"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
docker build -f platform/Dockerfile -t "$REPO:$TAG" .
docker push "$REPO:$TAG"
```

For a first HTTP smoke test, omit `platformCertificateArn` and use the emitted
`PlatformLoadBalancerDnsName`. For a real WorkOS production redirect, create and
validate an ACM certificate for `app.usepuddle.com`, then deploy with the
certificate ARN:

```sh
npm run cdk -- deploy \
  -c envName=dev \
  -c region="$REGION" \
  -c deployBackendService=true \
  -c backendImageTag="<backend-tag>" \
  -c liveKitUrl=wss://your-livekit-host \
  -c enableLiveKitRecordings=true \
  -c platformHosting=container \
  -c platformImageTag="$TAG" \
  -c platformDomainName=app.usepuddle.com \
  -c platformCertificateArn="<acm-certificate-arn>"
```

After the platform ALB is created, add this DNS record in Namecheap:

```text
Type:  CNAME
Host:  app
Value: <PlatformLoadBalancerDnsName>
TTL:   Automatic
```

Then add the WorkOS production redirect URI:

```text
https://app.usepuddle.com/callback
```
