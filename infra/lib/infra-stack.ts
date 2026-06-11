import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { PuddleEnvConfig } from './config';

export interface InfraStackProps extends cdk.StackProps {
  config: PuddleEnvConfig;
}

interface RuntimeSecrets {
  livekitApiKey: secretsmanager.ISecret;
  livekitApiSecret: secretsmanager.ISecret;
  anthropicApiKey: secretsmanager.ISecret;
  deepgramApiKey: secretsmanager.ISecret;
  cartesiaApiKey: secretsmanager.ISecret;
  geminiApiKey: secretsmanager.ISecret;
  backendInternalToken: secretsmanager.ISecret;
  platformAuthSecret: secretsmanager.ISecret;
  workosApiKey: secretsmanager.ISecret;
  workosClientId: secretsmanager.ISecret;
  livekitEgressS3Credentials?: secretsmanager.ISecret;
}

interface RuntimeRoles {
  backendTaskRole: iam.Role;
  backendExecutionRole: iam.Role;
  agentTaskRole: iam.Role;
  agentExecutionRole: iam.Role;
  platformTaskRole: iam.Role;
  platformExecutionRole: iam.Role;
}

interface StackSecurityGroups {
  backendTasks: ec2.SecurityGroup;
  backendLoadBalancer: ec2.SecurityGroup;
  platformLoadBalancer: ec2.SecurityGroup;
  platformTasks: ec2.SecurityGroup;
  agentTasks: ec2.SecurityGroup;
  futureDatabase: ec2.SecurityGroup;
  devTunnel?: ec2.SecurityGroup;
}

interface BackendDeployment {
  service: ecs.FargateService;
  taskDefinition: ecs.FargateTaskDefinition;
  migrationTaskDefinition: ecs.FargateTaskDefinition;
  loadBalancer: elbv2.ApplicationLoadBalancer;
  listener: elbv2.ApplicationListener;
}

interface AgentDeployment {
  service: ecs.FargateService;
  taskDefinition: ecs.FargateTaskDefinition;
}

interface PlatformDeployment {
  service: ecs.FargateService;
  taskDefinition: ecs.FargateTaskDefinition;
  loadBalancer: elbv2.ApplicationLoadBalancer;
  listener: elbv2.ApplicationListener;
  publicBaseUrl: string;
}

interface DevTunnelDeployment {
  instance: ec2.Instance;
}

const RUNTIME_SECRET_PATHS: Record<keyof RuntimeSecrets, string> = {
  livekitApiKey: 'livekit/api-key',
  livekitApiSecret: 'livekit/api-secret',
  anthropicApiKey: 'providers/anthropic-api-key',
  deepgramApiKey: 'providers/deepgram-api-key',
  cartesiaApiKey: 'providers/cartesia-api-key',
  geminiApiKey: 'providers/gemini-api-key',
  backendInternalToken: 'backend/internal-token',
  platformAuthSecret: 'platform/auth-secret',
  workosApiKey: 'platform/workos-api-key',
  workosClientId: 'platform/workos-client-id',
  livekitEgressS3Credentials: 'livekit/egress-s3-credentials',
};

const DATABASE_PASSWORD_EXCLUDE_CHARS = ' %+~`#$&*()|[]{}:;<>?!\'/@"\\';

export class InfraStack extends cdk.Stack {
  private readonly cfg: PuddleEnvConfig;

  constructor(scope: Construct, id: string, props: InfraStackProps) {
    super(scope, id, props);

    this.cfg = props.config;
    this.validateConfig();
    this.applyTags();

    const logRetention = this.toLogRetention(this.cfg.logs.retentionDays);
    const removalPolicy = this.removalPolicy();
    const autoDeleteObjects = this.cfg.envName === 'dev';

    const accessLogsBucket = this.createAccessLogsBucket(removalPolicy, autoDeleteObjects);
    const artifactsBucket = this.createArtifactsBucket(
      accessLogsBucket,
      removalPolicy,
      autoDeleteObjects,
    );
    const webBuckets = this.createWebBuckets(
      accessLogsBucket,
      removalPolicy,
      autoDeleteObjects,
    );
    const repositories = this.createRepositories();
    const runtimeSecrets = this.createRuntimeSecrets(removalPolicy, artifactsBucket);
    const logGroups = this.createLogGroups(logRetention, removalPolicy);

    const vpc = this.createVpc();
    const securityGroups = this.createSecurityGroups(vpc);
    const database = this.createDatabase(vpc, securityGroups.futureDatabase, removalPolicy);
    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: this.name('cluster'),
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      vpc,
    });
    const devTunnelDeployment = this.createDevTunnelDeployment({ vpc, securityGroups });

    const runtimeRoles = this.createRuntimeRoles(runtimeSecrets, artifactsBucket, database);
    const githubCiRole = this.createGithubCiRole(repositories, webBuckets);
    const backendDeployment = this.createBackendDeployment({
      vpc,
      cluster,
      securityGroups,
      repositories,
      runtimeSecrets,
      logGroups,
      runtimeRoles,
      database,
      artifactsBucket,
    });
    const agentDeployment = this.createAgentDeployment({
      vpc,
      cluster,
      securityGroups,
      repositories,
      runtimeSecrets,
      logGroups,
      runtimeRoles,
      artifactsBucket,
      backendDeployment,
    });
    const platformDeployment = this.createPlatformDeployment({
      vpc,
      cluster,
      securityGroups,
      accessLogsBucket,
      repositories,
      runtimeSecrets,
      logGroups,
      runtimeRoles,
      backendDeployment,
    });

    this.createOutputs({
      vpc,
      securityGroups,
      cluster,
      accessLogsBucket,
      artifactsBucket,
      webBuckets,
      repositories,
      runtimeSecrets,
      database,
      logGroups,
      runtimeRoles,
      githubCiRole,
      backendDeployment,
      agentDeployment,
      platformDeployment,
      devTunnelDeployment,
    });
  }

  private validateConfig(): void {
    if (this.cfg.networkMode !== 'private-tasks-public-alb') {
      throw new Error(`Unsupported networkMode: ${this.cfg.networkMode}`);
    }

    if (this.cfg.vpc.maxAzs < 2) {
      throw new Error('VPC maxAzs must be at least 2 for the foundation stack.');
    }

    if (this.cfg.vpc.natGateways < 1) {
      throw new Error('At least one NAT gateway is required for private ECS task egress.');
    }

    if (this.cfg.vpc.natGateways > this.cfg.vpc.maxAzs) {
      throw new Error('natGateways cannot exceed maxAzs.');
    }

    if (this.cfg.envName === 'prod' && this.cfg.devTunnel.enabled) {
      throw new Error('Dev tunnel target is not allowed in prod.');
    }

    if (
      this.cfg.devTunnel.enabled &&
      new ec2.InstanceType(this.cfg.devTunnel.instanceType).architecture !==
        ec2.InstanceArchitecture.X86_64
    ) {
      throw new Error(
        'devTunnelInstanceType must use an x86_64 instance type compatible with the default Amazon Linux 2023 AMI.',
      );
    }

    if (!this.cfg.database.external) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(this.cfg.database.name)) {
        throw new Error(
          'databaseName must start with a letter and contain only letters, numbers, or underscores.',
        );
      }

      if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(this.cfg.database.username)) {
        throw new Error(
          'databaseUsername must start with a letter and contain only letters, numbers, or underscores.',
        );
      }

      if (this.cfg.database.allocatedStorageGb < 20) {
        throw new Error('databaseAllocatedStorageGb must be at least 20.');
      }

      if (this.cfg.database.maxAllocatedStorageGb < this.cfg.database.allocatedStorageGb) {
        throw new Error(
          'databaseMaxAllocatedStorageGb must be greater than or equal to databaseAllocatedStorageGb.',
        );
      }
    }

    if (this.cfg.backend.exposePublicly && !this.cfg.backend.requireAuth) {
      throw new Error('Refusing to deploy public backend without backend auth enabled.');
    }

    if (this.cfg.backend.exposePublicly) {
      throw new Error(
        'Public backend exposure is blocked until request authentication is implemented.',
      );
    }

    if (
      this.cfg.liveKit.recordingsEnabled &&
      this.cfg.liveKit.egressAssumeRoleExternalId &&
      !this.cfg.liveKit.egressAssumeRoleArn
    ) {
      throw new Error('liveKitEgressAssumeRoleExternalId requires liveKitEgressAssumeRoleArn.');
    }

    if (this.cfg.backend.deployService) {
      if (this.cfg.database.external) {
        throw new Error('deployBackendService currently requires the CDK-managed database.');
      }

      if (!this.cfg.liveKit.url) {
        throw new Error('deployBackendService requires a liveKitUrl CDK context value.');
      }

      if (this.cfg.backend.port < 1 || this.cfg.backend.port > 65535) {
        throw new Error('backendPort must be a valid TCP port.');
      }

    }

    const candidateDataServicesEnabled =
      this.cfg.backend.deployService ||
      this.cfg.agent.deployService ||
      this.cfg.platform.hosting !== 'disabled';

    if (
      this.cfg.envName === 'prod' &&
      candidateDataServicesEnabled &&
      this.cfg.database.external &&
      !this.cfg.database.allowRealCandidateDataExternal
    ) {
      throw new Error(
        'Refusing prod deploy with external database unless explicitly approved.',
      );
    }

    if (this.cfg.agent.deployService) {
      if (!this.cfg.backend.deployService) {
        throw new Error('deployAgentService requires deployBackendService=true.');
      }

      if (!this.cfg.liveKit.url) {
        throw new Error('deployAgentService requires a liveKitUrl CDK context value.');
      }

      if (this.cfg.agent.participantReconnectGraceSeconds < 1) {
        throw new Error('participantReconnectGraceSeconds must be at least 1.');
      }
    }

    if (this.cfg.platform.hosting === 'static-export') {
      throw new Error('Static platform hosting is not implemented yet.');
    }

    if (this.cfg.platform.hosting === 'container') {
      if (!this.cfg.backend.deployService) {
        throw new Error('platformHosting=container requires deployBackendService=true.');
      }

      if (this.cfg.platform.port < 1 || this.cfg.platform.port > 65535) {
        throw new Error('platformPort must be a valid TCP port.');
      }

      if (this.cfg.platform.certificateArn && !this.cfg.platform.domainName) {
        throw new Error('platformCertificateArn requires platformDomainName.');
      }

      if (this.cfg.envName === 'prod' && !this.cfg.platform.certificateArn) {
        throw new Error('prod platform container deploy requires platformCertificateArn.');
      }
    }

    if (
      this.cfg.githubOidc.enabled &&
      (!this.cfg.githubOidc.owner || !this.cfg.githubOidc.repo)
    ) {
      throw new Error(
        'enableGithubOidc requires githubOwner and githubRepo CDK context values.',
      );
    }
  }

  private applyTags(): void {
    cdk.Tags.of(this).add('Project', 'PuddleVoiceAI');
    cdk.Tags.of(this).add('Environment', this.cfg.envName);
    cdk.Tags.of(this).add('ManagedBy', 'AWS CDK');
  }

  private createVpc(): ec2.Vpc {
    return new ec2.Vpc(this, 'Vpc', {
      vpcName: this.name('vpc'),
      maxAzs: this.cfg.vpc.maxAzs,
      natGateways: this.cfg.vpc.natGateways,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        {
          name: 'public-ingress',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private-app',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'isolated-data',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
      gatewayEndpoints: {
        S3: {
          service: ec2.GatewayVpcEndpointAwsService.S3,
        },
      },
    });
  }

  private createSecurityGroups(vpc: ec2.IVpc): StackSecurityGroups {
    const groups: StackSecurityGroups = {
      backendTasks: new ec2.SecurityGroup(this, 'BackendTasksSecurityGroup', {
        vpc,
        securityGroupName: this.name('backend-tasks-sg'),
        description: 'Backend ECS tasks. No public ingress.',
        allowAllOutbound: true,
      }),
      backendLoadBalancer: new ec2.SecurityGroup(
        this,
        'BackendLoadBalancerSecurityGroup',
        {
          vpc,
          securityGroupName: this.name('backend-alb-sg'),
          description: 'Internal backend load balancer ingress from application tasks.',
          allowAllOutbound: true,
        },
      ),
      platformLoadBalancer: new ec2.SecurityGroup(
        this,
        'PlatformLoadBalancerSecurityGroup',
        {
          vpc,
          securityGroupName: this.name('platform-alb-sg'),
          description: 'Public platform load balancer ingress.',
          allowAllOutbound: true,
        },
      ),
      platformTasks: new ec2.SecurityGroup(this, 'PlatformTasksSecurityGroup', {
        vpc,
        securityGroupName: this.name('platform-tasks-sg'),
        description: 'Platform ECS tasks. No public ingress.',
        allowAllOutbound: true,
      }),
      agentTasks: new ec2.SecurityGroup(this, 'AgentTasksSecurityGroup', {
        vpc,
        securityGroupName: this.name('agent-tasks-sg'),
        description: 'Agent ECS tasks. No inbound access.',
        allowAllOutbound: true,
      }),
      futureDatabase: new ec2.SecurityGroup(this, 'FutureDatabaseSecurityGroup', {
        vpc,
        securityGroupName: this.name('data-sg'),
        description: 'Future RDS/Aurora ingress from application tasks only.',
        allowAllOutbound: false,
      }),
    };

    if (this.cfg.devTunnel.enabled) {
      groups.devTunnel = new ec2.SecurityGroup(this, 'DevTunnelSecurityGroup', {
        vpc,
        securityGroupName: this.name('dev-tunnel-sg'),
        description: 'SSM tunnel target for local development access.',
        allowAllOutbound: false,
      });
    }

    const {
      backendTasks,
      backendLoadBalancer,
      platformLoadBalancer,
      platformTasks,
      agentTasks,
      futureDatabase,
      devTunnel,
    } = groups;

    futureDatabase.addIngressRule(
      backendTasks,
      ec2.Port.tcp(5432),
      'Postgres from backend tasks',
    );
    futureDatabase.addIngressRule(
      platformTasks,
      ec2.Port.tcp(5432),
      'Postgres from platform tasks',
    );
    futureDatabase.addIngressRule(
      agentTasks,
      ec2.Port.tcp(5432),
      'Postgres from agent tasks',
    );

    if (devTunnel) {
      backendLoadBalancer.addIngressRule(
        devTunnel,
        ec2.Port.tcp(80),
        'Backend load balancer access from the dev tunnel',
      );
      futureDatabase.addIngressRule(
        devTunnel,
        ec2.Port.tcp(5432),
        'Postgres from the dev tunnel',
      );
      devTunnel.addEgressRule(
        backendLoadBalancer,
        ec2.Port.tcp(80),
        'Backend load balancer egress from the dev tunnel',
      );
      devTunnel.addEgressRule(
        futureDatabase,
        ec2.Port.tcp(5432),
        'Postgres egress from the dev tunnel',
      );
      // SSM port forwarding uses HTTPS; VPC DNS resolution is handled by the resolver.
      devTunnel.addEgressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(443),
        'HTTPS egress for SSM connectivity',
      );
    }

    backendTasks.addIngressRule(
      platformTasks,
      ec2.Port.tcp(this.cfg.backend.port),
      'Backend API access from platform tasks',
    );
    backendTasks.addIngressRule(
      backendLoadBalancer,
      ec2.Port.tcp(this.cfg.backend.port),
      'Backend API access from the backend load balancer',
    );
    backendLoadBalancer.addIngressRule(
      platformTasks,
      ec2.Port.tcp(80),
      'Backend load balancer access from platform tasks',
    );
    backendLoadBalancer.addIngressRule(
      agentTasks,
      ec2.Port.tcp(80),
      'Backend load balancer access from agent tasks',
    );
    platformLoadBalancer.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP from the internet',
    );
    platformLoadBalancer.addIngressRule(
      ec2.Peer.anyIpv6(),
      ec2.Port.tcp(80),
      'HTTP from the internet',
    );
    platformLoadBalancer.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS from the internet',
    );
    platformLoadBalancer.addIngressRule(
      ec2.Peer.anyIpv6(),
      ec2.Port.tcp(443),
      'HTTPS from the internet',
    );
    platformTasks.addIngressRule(
      platformLoadBalancer,
      ec2.Port.tcp(this.cfg.platform.port),
      'Platform app traffic from the platform load balancer',
    );

    return groups;
  }

  private createDevTunnelDeployment(params: {
    vpc: ec2.IVpc;
    securityGroups: StackSecurityGroups;
  }): DevTunnelDeployment | undefined {
    if (!this.cfg.devTunnel.enabled) {
      return undefined;
    }

    if (!params.securityGroups.devTunnel) {
      throw new Error('Dev tunnel deployment requires a dev tunnel security group.');
    }

    const role = new iam.Role(this, 'DevTunnelInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    const instance = new ec2.Instance(this, 'DevTunnelInstance', {
      vpc: params.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      instanceType: new ec2.InstanceType(this.cfg.devTunnel.instanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      role,
      securityGroup: params.securityGroups.devTunnel,
      requireImdsv2: true,
      instanceName: this.name('dev-tunnel'),
    });

    return { instance };
  }

  private createAccessLogsBucket(
    removalPolicy: cdk.RemovalPolicy,
    autoDeleteObjects: boolean,
  ): s3.Bucket {
    return new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: this.physicalName('access-logs'),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      versioned: false,
      removalPolicy,
      autoDeleteObjects,
      lifecycleRules: [
        {
          id: 'ExpireAccessLogs',
          expiration: cdk.Duration.days(this.cfg.envName === 'prod' ? 365 : 90),
        },
      ],
    });
  }

  private createArtifactsBucket(
    accessLogsBucket: s3.IBucket,
    removalPolicy: cdk.RemovalPolicy,
    autoDeleteObjects: boolean,
  ): s3.Bucket {
    return new s3.Bucket(this, 'ArtifactsBucket', {
      bucketName: this.physicalName('artifacts'),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'artifacts/',
      removalPolicy,
      autoDeleteObjects,
      lifecycleRules: [
        {
          id: 'AbortIncompleteMultipartUploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          id: 'ExpireNoncurrentVersions',
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
    });
  }

  private createWebBuckets(
    accessLogsBucket: s3.IBucket,
    removalPolicy: cdk.RemovalPolicy,
    autoDeleteObjects: boolean,
  ): Record<string, s3.Bucket> {
    const apps = ['platform', 'room', 'review'] as const;
    return Object.fromEntries(
      apps.map((appName) => [
        appName,
        new s3.Bucket(this, `${this.toPascalCase(appName)}WebBucket`, {
          bucketName: this.physicalName(`${appName}-web`),
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          encryption: s3.BucketEncryption.S3_MANAGED,
          enforceSSL: true,
          objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
          versioned: true,
          serverAccessLogsBucket: accessLogsBucket,
          serverAccessLogsPrefix: `web/${appName}/`,
          removalPolicy,
          autoDeleteObjects,
          lifecycleRules: [
            {
              id: 'ExpireOldAssetVersions',
              noncurrentVersionExpiration: cdk.Duration.days(30),
            },
          ],
        }),
      ]),
    ) as Record<string, s3.Bucket>;
  }

  private createRepositories(): Record<string, ecr.Repository> {
    const services = ['backend', 'agent', 'platform'] as const;
    return Object.fromEntries(
      services.map((service) => [
        service,
        new ecr.Repository(this, `${this.toPascalCase(service)}Repository`, {
          repositoryName: this.name(service),
          encryption: ecr.RepositoryEncryption.AES_256,
          imageScanOnPush: true,
          imageTagMutability:
            this.cfg.envName === 'prod'
              ? ecr.TagMutability.IMMUTABLE
              : ecr.TagMutability.MUTABLE,
          removalPolicy: this.cfg.envName === 'prod'
            ? cdk.RemovalPolicy.RETAIN
            : cdk.RemovalPolicy.DESTROY,
          emptyOnDelete: this.cfg.envName !== 'prod',
          lifecycleRules: [
            {
              description: 'Remove untagged images after two weeks.',
              tagStatus: ecr.TagStatus.UNTAGGED,
              maxImageAge: cdk.Duration.days(14),
            },
            {
              description: 'Keep the most recent tagged images.',
              maxImageCount: this.cfg.envName === 'prod' ? 100 : 30,
            },
          ],
        }),
      ]),
    ) as Record<string, ecr.Repository>;
  }

  private createDatabase(
    vpc: ec2.IVpc,
    securityGroup: ec2.ISecurityGroup,
    removalPolicy: cdk.RemovalPolicy,
  ): rds.DatabaseInstance | undefined {
    if (this.cfg.database.external) {
      return undefined;
    }

    return new rds.DatabaseInstance(this, 'PostgresDatabase', {
      instanceIdentifier: this.name('postgres'),
      databaseName: this.cfg.database.name,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      credentials: rds.Credentials.fromGeneratedSecret(this.cfg.database.username, {
        secretName: this.secretName('database/credentials'),
        excludeCharacters: DATABASE_PASSWORD_EXCLUDE_CHARS,
      }),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [securityGroup],
      publiclyAccessible: false,
      instanceType: new ec2.InstanceType(this.cfg.database.instanceType),
      multiAz: this.cfg.database.multiAz,
      allocatedStorage: this.cfg.database.allocatedStorageGb,
      maxAllocatedStorage: this.cfg.database.maxAllocatedStorageGb,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(this.cfg.database.backupRetentionDays),
      deleteAutomatedBackups: this.cfg.envName !== 'prod',
      deletionProtection: this.cfg.database.deletionProtection,
      removalPolicy,
      autoMinorVersionUpgrade: true,
    });
  }

  private createRuntimeSecrets(
    removalPolicy: cdk.RemovalPolicy,
    artifactsBucket: s3.IBucket,
  ): RuntimeSecrets {
    const secrets: RuntimeSecrets = {
      livekitApiKey: this.createSecret(
        'LiveKitApiKey',
        RUNTIME_SECRET_PATHS.livekitApiKey,
        removalPolicy,
      ),
      livekitApiSecret: this.createSecret(
        'LiveKitApiSecret',
        RUNTIME_SECRET_PATHS.livekitApiSecret,
        removalPolicy,
      ),
      anthropicApiKey: this.createSecret(
        'AnthropicApiKey',
        RUNTIME_SECRET_PATHS.anthropicApiKey,
        removalPolicy,
      ),
      deepgramApiKey: this.createSecret(
        'DeepgramApiKey',
        RUNTIME_SECRET_PATHS.deepgramApiKey,
        removalPolicy,
      ),
      cartesiaApiKey: this.createSecret(
        'CartesiaApiKey',
        RUNTIME_SECRET_PATHS.cartesiaApiKey,
        removalPolicy,
      ),
      geminiApiKey: this.createSecret(
        'GeminiApiKey',
        RUNTIME_SECRET_PATHS.geminiApiKey,
        removalPolicy,
      ),
      backendInternalToken: this.createSecret(
        'BackendInternalToken',
        RUNTIME_SECRET_PATHS.backendInternalToken,
        removalPolicy,
      ),
      platformAuthSecret: this.createSecret(
        'PlatformAuthSecret',
        RUNTIME_SECRET_PATHS.platformAuthSecret,
        removalPolicy,
      ),
      workosApiKey: secretsmanager.Secret.fromSecretNameV2(
        this,
        'WorkosApiKey',
        this.secretName(RUNTIME_SECRET_PATHS.workosApiKey),
      ),
      workosClientId: secretsmanager.Secret.fromSecretNameV2(
        this,
        'WorkosClientId',
        this.secretName(RUNTIME_SECRET_PATHS.workosClientId),
      ),
    };

    if (this.cfg.liveKit.recordingsEnabled) {
      secrets.livekitEgressS3Credentials = this.createLiveKitEgressS3CredentialsSecret(
        artifactsBucket,
        removalPolicy,
      );
    }

    return secrets;
  }

  private createLiveKitEgressS3CredentialsSecret(
    artifactsBucket: s3.IBucket,
    removalPolicy: cdk.RemovalPolicy,
  ): secretsmanager.Secret {
    const user = new iam.User(this, 'LiveKitEgressUploadUser', {
      userName: this.name('livekit-egress-upload-user'),
    });

    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetBucketLocation', 's3:ListBucketMultipartUploads'],
        resources: [artifactsBucket.bucketArn],
      }),
    );
    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:AbortMultipartUpload', 's3:ListMultipartUploadParts', 's3:PutObject'],
        resources: [artifactsBucket.arnForObjects('*')],
      }),
    );

    const accessKey = new iam.AccessKey(this, 'LiveKitEgressUploadAccessKey', {
      user,
    });
    const secret = new secretsmanager.Secret(this, 'LiveKitEgressS3Credentials', {
      secretName: this.secretName(RUNTIME_SECRET_PATHS.livekitEgressS3Credentials),
      description: `${this.cfg.envName} LiveKit Cloud Egress S3 upload credentials.`,
      secretObjectValue: {
        accessKeyId: cdk.SecretValue.unsafePlainText(accessKey.accessKeyId),
        secretAccessKey: accessKey.secretAccessKey,
      },
    });
    secret.applyRemovalPolicy(removalPolicy);

    return secret;
  }

  private createSecret(
    constructId: string,
    path: string,
    removalPolicy: cdk.RemovalPolicy,
  ): secretsmanager.Secret {
    const secret = new secretsmanager.Secret(this, constructId, {
      secretName: this.secretName(path),
      description: `${this.cfg.envName} ${path} runtime secret placeholder.`,
      generateSecretString: {
        passwordLength: 40,
        excludePunctuation: true,
      },
    });
    secret.applyRemovalPolicy(removalPolicy);
    return secret;
  }

  private createLogGroups(
    retention: logs.RetentionDays,
    removalPolicy: cdk.RemovalPolicy,
  ): Record<string, logs.LogGroup> {
    const names = ['backend', 'agent', 'platform', 'migrations'] as const;
    return Object.fromEntries(
      names.map((name) => [
        name,
        new logs.LogGroup(this, `${this.toPascalCase(name)}LogGroup`, {
          logGroupName: `/aws/ecs/${this.cfg.resourcePrefix}/${name}`,
          retention,
          removalPolicy,
        }),
      ]),
    ) as Record<string, logs.LogGroup>;
  }

  private createRuntimeRoles(
    runtimeSecrets: RuntimeSecrets,
    artifactsBucket: s3.IBucket,
    database: rds.DatabaseInstance | undefined,
  ): RuntimeRoles {
    const backendTaskRole = this.createTaskRole(
      'BackendTaskRole',
      'backend task role',
      'backend-task-role',
    );
    const backendExecutionRole = this.createExecutionRole(
      'BackendExecutionRole',
      'backend task execution role',
      'backend-execution-role',
    );
    const agentTaskRole = this.createTaskRole(
      'AgentTaskRole',
      'agent task role',
      'agent-task-role',
    );
    const agentExecutionRole = this.createExecutionRole(
      'AgentExecutionRole',
      'agent task execution role',
      'agent-execution-role',
    );
    const platformTaskRole = this.createTaskRole(
      'PlatformTaskRole',
      'platform task role',
      'platform-task-role',
    );
    const platformExecutionRole = this.createExecutionRole(
      'PlatformExecutionRole',
      'platform task execution role',
      'platform-execution-role',
    );
    artifactsBucket.grantReadWrite(backendTaskRole);
    artifactsBucket.grantReadWrite(agentTaskRole);
    artifactsBucket.grantRead(platformTaskRole);

    grantSecretsRead(backendExecutionRole, [
      runtimeSecrets.livekitApiKey,
      runtimeSecrets.livekitApiSecret,
      runtimeSecrets.backendInternalToken,
      ...(runtimeSecrets.livekitEgressS3Credentials
        ? [runtimeSecrets.livekitEgressS3Credentials]
        : []),
    ]);
    grantSecretsRead(agentExecutionRole, [
      runtimeSecrets.livekitApiKey,
      runtimeSecrets.livekitApiSecret,
      runtimeSecrets.anthropicApiKey,
      runtimeSecrets.deepgramApiKey,
      runtimeSecrets.cartesiaApiKey,
      runtimeSecrets.geminiApiKey,
      runtimeSecrets.backendInternalToken,
    ]);
    grantSecretsRead(platformExecutionRole, [
      runtimeSecrets.backendInternalToken,
      runtimeSecrets.platformAuthSecret,
      runtimeSecrets.workosApiKey,
      runtimeSecrets.workosClientId,
    ]);

    if (database?.secret) {
      database.secret.grantRead(backendExecutionRole);
      database.secret.grantRead(agentExecutionRole);
    }

    return {
      backendTaskRole,
      backendExecutionRole,
      agentTaskRole,
      agentExecutionRole,
      platformTaskRole,
      platformExecutionRole,
    };
  }

  private createTaskRole(
    constructId: string,
    description: string,
    roleNameSuffix: string,
  ): iam.Role {
    return new iam.Role(this, constructId, {
      roleName: this.name(roleNameSuffix),
      description: `${this.cfg.envName} ${description}.`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
  }

  private createExecutionRole(
    constructId: string,
    description: string,
    roleNameSuffix: string,
  ): iam.Role {
    const role = new iam.Role(this, constructId, {
      roleName: this.name(roleNameSuffix),
      description: `${this.cfg.envName} ${description}.`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    return role;
  }

  private createBackendDeployment(params: {
    vpc: ec2.IVpc;
    cluster: ecs.ICluster;
    securityGroups: StackSecurityGroups;
    repositories: Record<string, ecr.IRepository>;
    runtimeSecrets: RuntimeSecrets;
    logGroups: Record<string, logs.ILogGroup>;
    runtimeRoles: RuntimeRoles;
    database?: rds.DatabaseInstance;
    artifactsBucket: s3.IBucket;
  }): BackendDeployment | undefined {
    if (!this.cfg.backend.deployService) {
      return undefined;
    }

    const { database } = params;
    if (!database?.secret) {
      throw new Error('Backend service deployment requires database credentials.');
    }

    const liveKitUrl = this.cfg.liveKit.url;
    if (!liveKitUrl) {
      throw new Error('Backend service deployment requires liveKitUrl.');
    }

    const backendImage = ecs.ContainerImage.fromEcrRepository(
      params.repositories.backend,
      this.cfg.backend.imageTag ?? 'latest',
    );
    const recordingsEnabled = this.cfg.liveKit.recordingsEnabled;
    const useEgressAssumeRoleExternalId =
      recordingsEnabled &&
      Boolean(this.cfg.liveKit.egressAssumeRoleExternalId) &&
      Boolean(this.cfg.liveKit.egressAssumeRoleArn);
    const containerEnvironment = {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: String(this.cfg.backend.port),
      LIVEKIT_URL: liveKitUrl,
      PUDDLE_RECORDINGS_ENABLED: recordingsEnabled ? 'true' : 'false',
      ...(recordingsEnabled
        ? {
            PUDDLE_ARTIFACTS_BUCKET: params.artifactsBucket.bucketName,
            PUDDLE_ARTIFACTS_REGION: cdk.Stack.of(this).region,
          }
        : {}),
      ...(recordingsEnabled && this.cfg.liveKit.egressAssumeRoleArn
        ? {
            PUDDLE_EGRESS_S3_ASSUME_ROLE_ARN: this.cfg.liveKit.egressAssumeRoleArn,
          }
        : {}),
      ...(useEgressAssumeRoleExternalId
        ? {
            PUDDLE_EGRESS_S3_ASSUME_ROLE_EXTERNAL_ID:
              this.cfg.liveKit.egressAssumeRoleExternalId,
          }
        : {}),
      AWS_REGION: cdk.Stack.of(this).region,
      ...(recordingsEnabled && this.cfg.platform.domainName
        ? {
            PUDDLE_LIVEKIT_WEBHOOK_URL: `${this.platformPublicBaseUrl()}/api/livekit/webhook`,
          }
        : {}),
      DATABASE_HOST: database.dbInstanceEndpointAddress,
      DATABASE_PORT: database.dbInstanceEndpointPort,
      DATABASE_NAME: this.cfg.database.name,
      DATABASE_SSL: 'true',
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
    };
    const containerSecrets = {
      LIVEKIT_API_KEY: ecs.Secret.fromSecretsManager(params.runtimeSecrets.livekitApiKey),
      LIVEKIT_API_SECRET: ecs.Secret.fromSecretsManager(
        params.runtimeSecrets.livekitApiSecret,
      ),
      PUDDLE_BACKEND_INTERNAL_TOKEN: ecs.Secret.fromSecretsManager(
        params.runtimeSecrets.backendInternalToken,
      ),
      ...(recordingsEnabled && params.runtimeSecrets.livekitEgressS3Credentials
        ? {
            PUDDLE_EGRESS_S3_ACCESS_KEY_ID: ecs.Secret.fromSecretsManager(
              params.runtimeSecrets.livekitEgressS3Credentials,
              'accessKeyId',
            ),
            PUDDLE_EGRESS_S3_SECRET_ACCESS_KEY: ecs.Secret.fromSecretsManager(
              params.runtimeSecrets.livekitEgressS3Credentials,
              'secretAccessKey',
            ),
          }
        : {}),
      DATABASE_USER: ecs.Secret.fromSecretsManager(database.secret, 'username'),
      DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(database.secret, 'password'),
    };

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'BackendTaskDefinition',
      {
        family: this.name('backend'),
        cpu: this.cfg.backend.cpu,
        memoryLimitMiB: this.cfg.backend.memoryMiB,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
        taskRole: params.runtimeRoles.backendTaskRole,
        executionRole: params.runtimeRoles.backendExecutionRole,
      },
    );
    const backendContainer = taskDefinition.addContainer('BackendContainer', {
      containerName: 'backend',
      image: backendImage,
      environment: containerEnvironment,
      secrets: containerSecrets,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: params.logGroups.backend,
        streamPrefix: 'backend',
      }),
    });
    backendContainer.addPortMappings({
      containerPort: this.cfg.backend.port,
      protocol: ecs.Protocol.TCP,
    });

    const migrationTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      'BackendMigrationTaskDefinition',
      {
        family: this.name('backend-migrations'),
        cpu: this.cfg.backend.cpu,
        memoryLimitMiB: this.cfg.backend.memoryMiB,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
        taskRole: params.runtimeRoles.backendTaskRole,
        executionRole: params.runtimeRoles.backendExecutionRole,
      },
    );
    migrationTaskDefinition.addContainer('BackendMigrationContainer', {
      containerName: 'backend-migrations',
      image: backendImage,
      command: ['node', 'dist/db/migrate.js'],
      environment: containerEnvironment,
      secrets: containerSecrets,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: params.logGroups.migrations,
        streamPrefix: 'backend',
      }),
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'BackendLoadBalancer', {
      vpc: params.vpc,
      internetFacing: false,
      securityGroup: params.securityGroups.backendLoadBalancer,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    const listener = loadBalancer.addListener('BackendHttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
    });

    const service = new ecs.FargateService(this, 'BackendService', {
      cluster: params.cluster,
      serviceName: this.name('backend-service'),
      taskDefinition,
      desiredCount: this.cfg.backend.desiredCount,
      assignPublicIp: false,
      securityGroups: [params.securityGroups.backendTasks],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      circuitBreaker: {
        rollback: true,
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    listener.addTargets('BackendTargets', {
      targets: [service],
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: this.cfg.backend.port,
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: '/healthz',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
    });

    return {
      service,
      taskDefinition,
      migrationTaskDefinition,
      loadBalancer,
      listener,
    };
  }

  private createAgentDeployment(params: {
    vpc: ec2.IVpc;
    cluster: ecs.ICluster;
    securityGroups: StackSecurityGroups;
    repositories: Record<string, ecr.IRepository>;
    runtimeSecrets: RuntimeSecrets;
    logGroups: Record<string, logs.ILogGroup>;
    runtimeRoles: RuntimeRoles;
    artifactsBucket: s3.IBucket;
    backendDeployment?: BackendDeployment;
  }): AgentDeployment | undefined {
    if (!this.cfg.agent.deployService) {
      return undefined;
    }

    const { backendDeployment } = params;
    if (!backendDeployment) {
      throw new Error('Agent service deployment requires a backend deployment.');
    }

    const liveKitUrl = this.cfg.liveKit.url;
    if (!liveKitUrl) {
      throw new Error('Agent service deployment requires liveKitUrl.');
    }

    const agentImage = ecs.ContainerImage.fromEcrRepository(
      params.repositories.agent,
      this.cfg.agent.imageTag ?? 'latest',
    );
    const containerEnvironment = {
      LIVEKIT_URL: liveKitUrl,
      PUDDLE_ENV_NAME: this.cfg.envName,
      PUDDLE_ARTIFACTS_BUCKET: params.artifactsBucket.bucketName,
      PUDDLE_PARTICIPANT_RECONNECT_GRACE_SECONDS: String(
        this.cfg.agent.participantReconnectGraceSeconds,
      ),
      PUDDLE_BACKEND_BASE_URL: `http://${backendDeployment.loadBalancer.loadBalancerDnsName}`,
      AWS_REGION: cdk.Stack.of(this).region,
      PYTHONUNBUFFERED: '1',
    };
    const containerSecrets = {
      LIVEKIT_API_KEY: ecs.Secret.fromSecretsManager(params.runtimeSecrets.livekitApiKey),
      LIVEKIT_API_SECRET: ecs.Secret.fromSecretsManager(
        params.runtimeSecrets.livekitApiSecret,
      ),
      ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(
        params.runtimeSecrets.anthropicApiKey,
      ),
      DEEPGRAM_API_KEY: ecs.Secret.fromSecretsManager(
        params.runtimeSecrets.deepgramApiKey,
      ),
      CARTESIA_API_KEY: ecs.Secret.fromSecretsManager(
        params.runtimeSecrets.cartesiaApiKey,
      ),
      GEMINI_API_KEY: ecs.Secret.fromSecretsManager(params.runtimeSecrets.geminiApiKey),
      PUDDLE_BACKEND_INTERNAL_TOKEN: ecs.Secret.fromSecretsManager(
        params.runtimeSecrets.backendInternalToken,
      ),
    };

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'AgentTaskDefinition', {
      family: this.name('agent'),
      cpu: this.cfg.agent.cpu,
      memoryLimitMiB: this.cfg.agent.memoryMiB,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      taskRole: params.runtimeRoles.agentTaskRole,
      executionRole: params.runtimeRoles.agentExecutionRole,
    });
    taskDefinition.addContainer('AgentContainer', {
      containerName: 'agent',
      image: agentImage,
      command: ['python', '-m', 'agent.worker', 'start'],
      environment: containerEnvironment,
      secrets: containerSecrets,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: params.logGroups.agent,
        streamPrefix: 'agent',
      }),
    });

    const service = new ecs.FargateService(this, 'AgentService', {
      cluster: params.cluster,
      serviceName: this.name('agent-service'),
      taskDefinition,
      desiredCount: this.cfg.agent.desiredCount,
      assignPublicIp: false,
      securityGroups: [params.securityGroups.agentTasks],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      circuitBreaker: {
        rollback: true,
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    return {
      service,
      taskDefinition,
    };
  }

  private createPlatformDeployment(params: {
    vpc: ec2.IVpc;
    cluster: ecs.ICluster;
    securityGroups: StackSecurityGroups;
    accessLogsBucket: s3.IBucket;
    repositories: Record<string, ecr.IRepository>;
    runtimeSecrets: RuntimeSecrets;
    logGroups: Record<string, logs.ILogGroup>;
    runtimeRoles: RuntimeRoles;
    backendDeployment?: BackendDeployment;
  }): PlatformDeployment | undefined {
    if (this.cfg.platform.hosting !== 'container') {
      return undefined;
    }

    const { backendDeployment } = params;
    if (!backendDeployment) {
      throw new Error('Platform container deployment requires a backend deployment.');
    }

    const loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      'PlatformLoadBalancer',
      {
        vpc: params.vpc,
        internetFacing: true,
        securityGroup: params.securityGroups.platformLoadBalancer,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
      },
    );
    loadBalancer.logAccessLogs(params.accessLogsBucket, 'platform-alb');

    const publicBaseUrl = this.platformPublicBaseUrl(loadBalancer.loadBalancerDnsName);
    const platformImage = ecs.ContainerImage.fromEcrRepository(
      params.repositories.platform,
      this.cfg.platform.imageTag ?? 'latest',
    );
    const containerEnvironment = {
      NODE_ENV: 'production',
      HOSTNAME: '0.0.0.0',
      PORT: String(this.cfg.platform.port),
      PUDDLE_PUBLIC_BASE_URL: publicBaseUrl,
      PUDDLE_WORKOS_REDIRECT_URI: `${publicBaseUrl}/callback`,
      NEXT_PUBLIC_SITE_URL: publicBaseUrl,
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${publicBaseUrl}/callback`,
      PUDDLE_ALLOWED_AUTH_DOMAINS: this.cfg.platform.allowedAuthDomains,
      PUDDLE_BACKEND_BASE_URL: `http://${backendDeployment.loadBalancer.loadBalancerDnsName}`,
      PUDDLE_DEFAULT_SCRIPT_VERSION: this.cfg.platform.defaultScriptVersion,
    };
    const containerSecrets = {
      WORKOS_API_KEY: ecs.Secret.fromSecretsManager(params.runtimeSecrets.workosApiKey),
      WORKOS_CLIENT_ID: ecs.Secret.fromSecretsManager(
        params.runtimeSecrets.workosClientId,
      ),
      WORKOS_COOKIE_PASSWORD: ecs.Secret.fromSecretsManager(
        params.runtimeSecrets.platformAuthSecret,
      ),
      PUDDLE_BACKEND_INTERNAL_TOKEN: ecs.Secret.fromSecretsManager(
        params.runtimeSecrets.backendInternalToken,
      ),
    };

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'PlatformTaskDefinition',
      {
        family: this.name('platform'),
        cpu: this.cfg.platform.cpu,
        memoryLimitMiB: this.cfg.platform.memoryMiB,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
        taskRole: params.runtimeRoles.platformTaskRole,
        executionRole: params.runtimeRoles.platformExecutionRole,
      },
    );
    const container = taskDefinition.addContainer('PlatformContainer', {
      containerName: 'platform',
      image: platformImage,
      environment: containerEnvironment,
      secrets: containerSecrets,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: params.logGroups.platform,
        streamPrefix: 'platform',
      }),
    });
    container.addPortMappings({
      containerPort: this.cfg.platform.port,
      protocol: ecs.Protocol.TCP,
    });

    const listener = this.createPlatformListener(loadBalancer);
    const service = new ecs.FargateService(this, 'PlatformService', {
      cluster: params.cluster,
      serviceName: this.name('platform-service'),
      taskDefinition,
      desiredCount: this.cfg.platform.desiredCount,
      assignPublicIp: false,
      securityGroups: [params.securityGroups.platformTasks],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      circuitBreaker: {
        rollback: true,
      },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: cdk.Duration.seconds(90),
    });

    listener.addTargets('PlatformTargets', {
      targets: [service],
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: this.cfg.platform.port,
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: '/',
        healthyHttpCodes: '200-399',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
    });

    return {
      service,
      taskDefinition,
      loadBalancer,
      listener,
      publicBaseUrl,
    };
  }

  private createPlatformListener(
    loadBalancer: elbv2.ApplicationLoadBalancer,
  ): elbv2.ApplicationListener {
    const certificateArn = this.cfg.platform.certificateArn;
    if (!certificateArn) {
      return loadBalancer.addListener('PlatformHttpListener', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        open: false,
      });
    }

    loadBalancer.addListener('PlatformHttpRedirectListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    return loadBalancer.addListener('PlatformHttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [
        acm.Certificate.fromCertificateArn(
          this,
          'PlatformCertificate',
          certificateArn,
        ),
      ],
      open: false,
    });
  }

  private createGithubCiRole(
    repositories: Record<string, ecr.IRepository>,
    webBuckets: Record<string, s3.IBucket>,
  ): iam.Role | undefined {
    if (!this.cfg.githubOidc.enabled) {
      return undefined;
    }

    const provider = this.cfg.githubOidc.providerArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          'GitHubOidcProvider',
          this.cfg.githubOidc.providerArn,
        )
      : new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        });

    const role = new iam.Role(this, 'GitHubCiRole', {
      roleName: this.name('github-ci-role'),
      description: `${this.cfg.envName} GitHub Actions image/static asset publishing role.`,
      assumedBy: new iam.OpenIdConnectPrincipal(provider).withConditions({
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${this.cfg.githubOidc.owner}/${this.cfg.githubOidc.repo}:*`,
        },
      }),
    });

    for (const repository of Object.values(repositories)) {
      repository.grantPullPush(role);
    }

    for (const bucket of Object.values(webBuckets)) {
      bucket.grantReadWrite(role);
      bucket.grantDelete(role);
    }

    return role;
  }

  private createOutputs(values: {
    vpc: ec2.IVpc;
    securityGroups: StackSecurityGroups;
    cluster: ecs.ICluster;
    accessLogsBucket: s3.IBucket;
    artifactsBucket: s3.IBucket;
    webBuckets: Record<string, s3.IBucket>;
    repositories: Record<string, ecr.IRepository>;
    runtimeSecrets: RuntimeSecrets;
    database?: rds.DatabaseInstance;
    logGroups: Record<string, logs.ILogGroup>;
    runtimeRoles: RuntimeRoles;
    githubCiRole?: iam.IRole;
    backendDeployment?: BackendDeployment;
    agentDeployment?: AgentDeployment;
    platformDeployment?: PlatformDeployment;
    devTunnelDeployment?: DevTunnelDeployment;
  }): void {
    new cdk.CfnOutput(this, 'EnvironmentName', {
      value: this.cfg.envName,
    });
    new cdk.CfnOutput(this, 'VpcId', {
      value: values.vpc.vpcId,
    });
    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: cdk.Fn.join(',', values.vpc.publicSubnets.map((subnet) => subnet.subnetId)),
    });
    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: cdk.Fn.join(
        ',',
        values.vpc.privateSubnets.map((subnet) => subnet.subnetId),
      ),
    });
    new cdk.CfnOutput(this, 'IsolatedSubnetIds', {
      value: cdk.Fn.join(
        ',',
        values.vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
      ),
    });
    new cdk.CfnOutput(this, 'ClusterName', {
      value: values.cluster.clusterName,
    });
    new cdk.CfnOutput(this, 'AccessLogsBucketName', {
      value: values.accessLogsBucket.bucketName,
    });
    new cdk.CfnOutput(this, 'ArtifactsBucketName', {
      value: values.artifactsBucket.bucketName,
    });

    if (values.database) {
      new cdk.CfnOutput(this, 'DatabaseInstanceEndpointAddress', {
        value: values.database.dbInstanceEndpointAddress,
      });
      new cdk.CfnOutput(this, 'DatabaseInstanceEndpointPort', {
        value: values.database.dbInstanceEndpointPort,
      });
      new cdk.CfnOutput(this, 'DatabaseName', {
        value: this.cfg.database.name,
      });
      if (values.database.secret) {
        new cdk.CfnOutput(this, 'DatabaseCredentialsSecretName', {
          value: this.secretName('database/credentials'),
        });
      }
    }

    for (const [name, bucket] of Object.entries(values.webBuckets)) {
      new cdk.CfnOutput(this, `${this.toPascalCase(name)}WebBucketName`, {
        value: bucket.bucketName,
      });
    }

    for (const [name, repository] of Object.entries(values.repositories)) {
      new cdk.CfnOutput(this, `${this.toPascalCase(name)}RepositoryUri`, {
        value: repository.repositoryUri,
      });
    }

    for (const name of Object.keys(values.runtimeSecrets) as Array<keyof RuntimeSecrets>) {
      new cdk.CfnOutput(this, `${this.toPascalCase(name)}SecretName`, {
        value: this.secretName(RUNTIME_SECRET_PATHS[name]),
      });
    }

    for (const [name, logGroup] of Object.entries(values.logGroups)) {
      new cdk.CfnOutput(this, `${this.toPascalCase(name)}LogGroupName`, {
        value: logGroup.logGroupName,
      });
    }

    for (const [name, securityGroup] of Object.entries(values.securityGroups)) {
      if (!securityGroup) {
        continue;
      }
      new cdk.CfnOutput(this, `${this.toPascalCase(name)}SecurityGroupId`, {
        value: securityGroup.securityGroupId,
      });
    }

    for (const [name, role] of Object.entries(values.runtimeRoles)) {
      if (!role) {
        continue;
      }
      new cdk.CfnOutput(this, `${this.toPascalCase(name)}Arn`, {
        value: role.roleArn,
      });
    }

    if (values.githubCiRole) {
      new cdk.CfnOutput(this, 'GitHubCiRoleArn', {
        value: values.githubCiRole.roleArn,
      });
    }

    if (values.backendDeployment) {
      new cdk.CfnOutput(this, 'BackendServiceName', {
        value: values.backendDeployment.service.serviceName,
      });
      new cdk.CfnOutput(this, 'BackendTaskDefinitionArn', {
        value: values.backendDeployment.taskDefinition.taskDefinitionArn,
      });
      new cdk.CfnOutput(this, 'BackendMigrationTaskDefinitionArn', {
        value: values.backendDeployment.migrationTaskDefinition.taskDefinitionArn,
      });
      new cdk.CfnOutput(this, 'BackendLoadBalancerDnsName', {
        value: values.backendDeployment.loadBalancer.loadBalancerDnsName,
      });
      new cdk.CfnOutput(this, 'BackendInternalBaseUrl', {
        value: `http://${values.backendDeployment.loadBalancer.loadBalancerDnsName}`,
      });
    }

    if (values.agentDeployment) {
      new cdk.CfnOutput(this, 'AgentServiceName', {
        value: values.agentDeployment.service.serviceName,
      });
      new cdk.CfnOutput(this, 'AgentTaskDefinitionArn', {
        value: values.agentDeployment.taskDefinition.taskDefinitionArn,
      });
    }

    if (values.platformDeployment) {
      new cdk.CfnOutput(this, 'PlatformServiceName', {
        value: values.platformDeployment.service.serviceName,
      });
      new cdk.CfnOutput(this, 'PlatformTaskDefinitionArn', {
        value: values.platformDeployment.taskDefinition.taskDefinitionArn,
      });
      new cdk.CfnOutput(this, 'PlatformLoadBalancerDnsName', {
        value: values.platformDeployment.loadBalancer.loadBalancerDnsName,
      });
      new cdk.CfnOutput(this, 'PlatformPublicBaseUrl', {
        value: values.platformDeployment.publicBaseUrl,
      });
    }

    if (values.devTunnelDeployment) {
      new cdk.CfnOutput(this, 'DevTunnelInstanceId', {
        value: values.devTunnelDeployment.instance.instanceId,
      });
    }
  }

  private toLogRetention(retentionDays: number): logs.RetentionDays {
    const retentionMap = new Map<number, logs.RetentionDays>([
      [1, logs.RetentionDays.ONE_DAY],
      [3, logs.RetentionDays.THREE_DAYS],
      [5, logs.RetentionDays.FIVE_DAYS],
      [7, logs.RetentionDays.ONE_WEEK],
      [14, logs.RetentionDays.TWO_WEEKS],
      [30, logs.RetentionDays.ONE_MONTH],
      [60, logs.RetentionDays.TWO_MONTHS],
      [90, logs.RetentionDays.THREE_MONTHS],
      [120, logs.RetentionDays.FOUR_MONTHS],
      [150, logs.RetentionDays.FIVE_MONTHS],
      [180, logs.RetentionDays.SIX_MONTHS],
      [365, logs.RetentionDays.ONE_YEAR],
      [400, logs.RetentionDays.THIRTEEN_MONTHS],
      [545, logs.RetentionDays.EIGHTEEN_MONTHS],
      [731, logs.RetentionDays.TWO_YEARS],
      [1096, logs.RetentionDays.THREE_YEARS],
      [1827, logs.RetentionDays.FIVE_YEARS],
      [2192, logs.RetentionDays.SIX_YEARS],
      [2557, logs.RetentionDays.SEVEN_YEARS],
      [2922, logs.RetentionDays.EIGHT_YEARS],
      [3288, logs.RetentionDays.NINE_YEARS],
      [3653, logs.RetentionDays.TEN_YEARS],
    ]);

    const retention = retentionMap.get(retentionDays);
    if (!retention) {
      throw new Error(
        `Unsupported logRetentionDays value: ${retentionDays}. Use an AWS CloudWatch Logs retention preset.`,
      );
    }

    return retention;
  }

  private removalPolicy(): cdk.RemovalPolicy {
    return this.cfg.envName === 'prod'
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;
  }

  private name(suffix: string): string {
    return `${this.cfg.resourcePrefix}-${suffix}`;
  }

  private platformPublicBaseUrl(loadBalancerDnsName?: string): string {
    if (this.cfg.platform.domainName) {
      return `${this.cfg.platform.certificateArn ? 'https' : 'http'}://${this.cfg.platform.domainName}`;
    }

    return loadBalancerDnsName ? `http://${loadBalancerDnsName}` : 'http://localhost:3000';
  }

  private secretName(path: string): string {
    return `/${this.cfg.resourcePrefix}/${path}`;
  }

  private physicalName(suffix: string): string | undefined {
    const account = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    if (cdk.Token.isUnresolved(account) || cdk.Token.isUnresolved(region)) {
      return undefined;
    }

    return `${this.name(suffix)}-${account}-${region}`.toLowerCase();
  }

  private toPascalCase(value: string): string {
    return value
      .split(/[^a-zA-Z0-9]/)
      .filter(Boolean)
      .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
      .join('');
  }
}

function grantSecretsRead(grantee: iam.IGrantable, secrets: secretsmanager.ISecret[]): void {
  for (const secret of secrets) {
    secret.grantRead(grantee);
  }
}
