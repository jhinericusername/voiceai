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

The backend can now be deployed as a private ECS/Fargate service behind an
internal ALB. Platform and agent services remain blocked by CDK guardrails until
their Dockerfiles, hosting/commands, and runtime contracts are implemented.
Public backend exposure is still blocked until request authentication is wired.

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

deployBackendService=false
exposeBackendPublicly=false
requireBackendAuth=true
backendImageTag=latest
backendDesiredCount=1
backendCpu=256
backendMemoryMiB=512
liveKitUrl=wss://...

deployAgentService=false
agentDesiredCount=1

platformHosting=disabled|container|static-export

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
  -c liveKitUrl=wss://your-livekit-host
```

After the service deploys, run migrations once with the emitted
`BackendMigrationTaskDefinitionArn` in the private app subnets using
`BackendTasksSecurityGroupId`. Then redeploy with `backendDesiredCount=1` to
start the backend service. The backend listener health check is `GET /healthz`;
it does not depend on Postgres or LiveKit.
