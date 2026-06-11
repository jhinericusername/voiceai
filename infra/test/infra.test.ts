import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { PuddleEnvConfig } from '../lib/config';
import { InfraStack } from '../lib/infra-stack';

describe('InfraStack', () => {
  test('creates the foundation resources with services disabled', () => {
    const stack = createStack();
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
    template.resourceCountIs('AWS::ECS::Cluster', 1);
    template.resourceCountIs('AWS::ECR::Repository', 3);
    template.resourceCountIs('AWS::S3::Bucket', 5);
    template.resourceCountIs('AWS::SecretsManager::Secret', 10);
    template.resourceCountIs('AWS::Logs::LogGroup', 4);
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
    template.resourceCountIs('AWS::RDS::DBSubnetGroup', 1);
    template.resourceCountIs('AWS::EC2::Instance', 1);

    template.hasResourceProperties('AWS::EC2::VPC', {
      Tags: Match.arrayWith([
        Match.objectLike({
          Key: 'Name',
          Value: 'puddle-videoagent-vpc',
        }),
      ]),
    });

    template.hasResourceProperties('AWS::ECS::Cluster', {
      ClusterName: 'puddle-videoagent-cluster',
    });

    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceIdentifier: 'puddle-videoagent-postgres',
      DBName: 'puddle',
      Engine: 'postgres',
      AllocatedStorage: '20',
      MaxAllocatedStorage: 100,
      PubliclyAccessible: false,
      StorageEncrypted: true,
      StorageType: 'gp3',
    });
  });

  test('creates a dev SSM tunnel target by default for dev stacks', () => {
    const stack = createStack();
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::Instance', 1);
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't3.nano',
      Tags: Match.arrayWith([
        Match.objectLike({
          Key: 'Name',
          Value: 'puddle-videoagent-dev-tunnel',
        }),
      ]),
    });
    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        {
          'Fn::Join': [
            '',
            Match.arrayWith([
              Match.objectLike({ Ref: 'AWS::Partition' }),
              ':iam::aws:policy/AmazonSSMManagedInstanceCore',
            ]),
          ],
        },
      ]),
    });
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'SSM tunnel target for local development access.',
      SecurityGroupEgress: Match.arrayWith([
        Match.objectLike({
          CidrIp: '0.0.0.0/0',
          Description: 'HTTPS egress for SSM connectivity',
          FromPort: 443,
          IpProtocol: 'tcp',
          ToPort: 443,
        }),
      ]),
    });
    template.resourcePropertiesCountIs(
      'AWS::EC2::SecurityGroup',
      {
        GroupDescription: 'SSM tunnel target for local development access.',
        SecurityGroupEgress: Match.arrayWith([
          Match.objectLike({
            CidrIp: '0.0.0.0/0',
            IpProtocol: '-1',
          }),
        ]),
      },
      0,
    );
    template.hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      Description: 'Backend load balancer egress from the dev tunnel',
      FromPort: 80,
      IpProtocol: 'tcp',
      ToPort: 80,
    });
    template.hasResourceProperties('AWS::EC2::SecurityGroupEgress', {
      Description: 'Postgres egress from the dev tunnel',
      FromPort: 5432,
      IpProtocol: 'tcp',
      ToPort: 5432,
    });
    template.hasOutput('DevTunnelInstanceId', {});
  });

  test('can disable the dev SSM tunnel target', () => {
    const stack = createStack({
      devTunnel: { enabled: false, instanceType: 't3.nano' },
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::EC2::Instance', 0);
  });

  test('blocks dev tunnel target in prod', () => {
    expect(() =>
      createStack({
        envName: 'prod',
        resourcePrefix: 'puddle-prod',
        vpc: { maxAzs: 2, natGateways: 2 },
        devTunnel: { enabled: true, instanceType: 't3.nano' },
        logs: { retentionDays: 90 },
      }),
    ).toThrow('Dev tunnel target is not allowed in prod.');
  });

  test('blocks ARM dev tunnel instance types', () => {
    expect(() =>
      createStack({
        devTunnel: { enabled: true, instanceType: 't4g.nano' },
      }),
    ).toThrow(
      'devTunnelInstanceType must use an x86_64 instance type compatible with the default Amazon Linux 2023 AMI.',
    );
  });

  test('blocks public backend exposure without auth', () => {
    expect(() =>
      createStack({
        backend: {
          ...defaultConfig().backend,
          exposePublicly: true,
          requireAuth: false,
        },
      }),
    ).toThrow('Refusing to deploy public backend without backend auth enabled.');
  });

  test('blocks public backend exposure even when auth is requested', () => {
    expect(() =>
      createStack({
        backend: {
          ...defaultConfig().backend,
          deployService: true,
          exposePublicly: true,
          requireAuth: true,
        },
        liveKit: {
          recordingsEnabled: false,
          url: 'wss://livekit.example',
        },
      }),
    ).toThrow('Public backend exposure is blocked');
  });

  test('requires LiveKit URL before deploying the backend service', () => {
    expect(() =>
      createStack({
        backend: {
          ...defaultConfig().backend,
          deployService: true,
        },
      }),
    ).toThrow('deployBackendService requires a liveKitUrl CDK context value.');
  });

  test('requires an assume-role ARN when an egress external ID is configured', () => {
    expect(() =>
      createStack({
        liveKit: {
          recordingsEnabled: true,
          egressAssumeRoleExternalId: 'external-id',
        },
      }),
    ).toThrow('liveKitEgressAssumeRoleExternalId requires liveKitEgressAssumeRoleArn.');
  });

  test('creates an internal ECS backend service when enabled', () => {
    const stack = createStack({
      backend: {
        ...defaultConfig().backend,
        deployService: true,
        imageTag: 'test',
      },
      liveKit: {
        recordingsEnabled: false,
        url: 'wss://livekit.example',
      },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ECS::Service', 1);
    template.resourceCountIs('AWS::ECS::TaskDefinition', 2);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 1);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internal',
      Type: 'application',
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/healthz',
      Matcher: {
        HttpCode: '200',
      },
    });
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            Match.objectLike({
              Name: 'PORT',
              Value: '8080',
            }),
            Match.objectLike({
              Name: 'LIVEKIT_URL',
              Value: 'wss://livekit.example',
            }),
            Match.objectLike({
              Name: 'PUDDLE_RECORDINGS_ENABLED',
              Value: 'false',
            }),
            Match.objectLike({
              Name: 'DATABASE_NAME',
              Value: 'puddle',
            }),
          ]),
          Secrets: Match.arrayWith([
            Match.objectLike({
              Name: 'LIVEKIT_API_KEY',
            }),
            Match.objectLike({
              Name: 'DATABASE_USER',
            }),
            Match.objectLike({
              Name: 'DATABASE_PASSWORD',
            }),
          ]),
        }),
      ]),
    });
    template.resourceCountIs('AWS::IAM::User', 0);
  });

  test('injects the Ashby integration encryption key only into backend tasks', () => {
    const stack = createStack({
      backend: {
        ...defaultConfig().backend,
        deployService: true,
        imageTag: 'test',
      },
      agent: {
        ...defaultConfig().agent,
        deployService: true,
        imageTag: 'test',
      },
      platform: {
        ...defaultConfig().platform,
        hosting: 'container',
        imageTag: 'test',
      },
      liveKit: {
        recordingsEnabled: false,
        url: 'wss://livekit.example',
      },
    });
    const template = Template.fromStack(stack);

    template.hasOutput('IntegrationEncryptionKeySecretName', {
      Value: Match.stringLikeRegexp('/integrations/encryption-key$'),
    });

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'backend',
          Secrets: Match.arrayWith([
            Match.objectLike({
              Name: 'PUDDLE_INTEGRATION_SECRET_KEY',
            }),
          ]),
        }),
      ]),
    });

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'backend-migrations',
          Secrets: Match.arrayWith([
            Match.objectLike({
              Name: 'PUDDLE_INTEGRATION_SECRET_KEY',
            }),
          ]),
        }),
      ]),
    });

    const taskDefinitions = template.findResources('AWS::ECS::TaskDefinition');
    const platformTask = Object.values(taskDefinitions).find((task) =>
      JSON.stringify(task).includes('"Name":"platform"'),
    );
    const agentTask = Object.values(taskDefinitions).find((task) =>
      JSON.stringify(task).includes('"Name":"agent"'),
    );

    expect(JSON.stringify(platformTask)).not.toContain('PUDDLE_INTEGRATION_SECRET_KEY');
    expect(JSON.stringify(agentTask)).not.toContain('PUDDLE_INTEGRATION_SECRET_KEY');
  });

  test('creates LiveKit Egress S3 credentials only when recordings are enabled', () => {
    const stack = createStack({
      backend: {
        ...defaultConfig().backend,
        deployService: true,
        imageTag: 'test',
      },
      liveKit: {
        recordingsEnabled: true,
        url: 'wss://livekit.example',
      },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            Match.objectLike({
              Name: 'PUDDLE_RECORDINGS_ENABLED',
              Value: 'true',
            }),
            Match.objectLike({
              Name: 'PUDDLE_ARTIFACTS_BUCKET',
            }),
          ]),
          Secrets: Match.arrayWith([
            Match.objectLike({
              Name: 'PUDDLE_EGRESS_S3_ACCESS_KEY_ID',
            }),
            Match.objectLike({
              Name: 'PUDDLE_EGRESS_S3_SECRET_ACCESS_KEY',
            }),
          ]),
        }),
      ]),
    });
    template.hasResourceProperties('AWS::IAM::User', {
      UserName: 'puddle-videoagent-livekit-egress-upload-user',
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['s3:PutObject']),
          }),
        ]),
      },
    });
  });

  test('blocks prod external database without explicit approval', () => {
    expect(() =>
      createStack({
        envName: 'prod',
        resourcePrefix: 'puddle-prod',
        vpc: {
          maxAzs: 2,
          natGateways: 2,
        },
        devTunnel: { enabled: false, instanceType: 't3.nano' },
        database: {
          ...defaultConfig().database,
          external: true,
          allowRealCandidateDataExternal: false,
        },
        agent: {
          ...defaultConfig().agent,
          deployService: true,
        },
      }),
    ).toThrow('Refusing prod deploy with external database unless explicitly approved.');
  });

  test('allows prod foundation while services are disabled', () => {
    expect(() =>
      createStack({
        envName: 'prod',
        resourcePrefix: 'puddle-prod',
        vpc: {
          maxAzs: 2,
          natGateways: 2,
        },
        devTunnel: { enabled: false, instanceType: 't3.nano' },
        database: {
          ...defaultConfig().database,
          external: true,
          allowRealCandidateDataExternal: false,
        },
        logs: {
          retentionDays: 90,
        },
      }),
    ).not.toThrow();
  });

  test('requires the backend service before deploying the agent service', () => {
    expect(() =>
      createStack({
        agent: {
          ...defaultConfig().agent,
          deployService: true,
        },
        liveKit: {
          recordingsEnabled: false,
          url: 'wss://livekit.example',
        },
      }),
    ).toThrow('deployAgentService requires deployBackendService=true.');
  });

  test('blocks static platform hosting during this pass', () => {
    expect(() =>
      createStack({
        platform: {
          ...defaultConfig().platform,
          hosting: 'static-export',
        },
      }),
    ).toThrow('Static platform hosting is not implemented yet.');
  });

  test('creates a private ECS agent service when enabled', () => {
    const stack = createStack({
      backend: {
        ...defaultConfig().backend,
        deployService: true,
        imageTag: 'backend-test',
      },
      agent: {
        ...defaultConfig().agent,
        deployService: true,
        imageTag: 'agent-test',
      },
      liveKit: {
        recordingsEnabled: false,
        url: 'wss://livekit.example',
      },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ECS::Service', 2);
    template.resourceCountIs('AWS::ECS::TaskDefinition', 3);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);

    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'puddle-videoagent-agent-service',
      DesiredCount: 1,
    });
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'puddle-videoagent-agent',
      Cpu: '1024',
      Memory: '2048',
      RuntimePlatform: {
        CpuArchitecture: 'ARM64',
        OperatingSystemFamily: 'LINUX',
      },
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'agent',
          Command: ['python', '-m', 'agent.worker', 'start'],
          Environment: Match.arrayWith([
            Match.objectLike({
              Name: 'LIVEKIT_URL',
              Value: 'wss://livekit.example',
            }),
            Match.objectLike({
              Name: 'PUDDLE_ARTIFACTS_BUCKET',
            }),
            Match.objectLike({
              Name: 'PUDDLE_PARTICIPANT_RECONNECT_GRACE_SECONDS',
              Value: '300',
            }),
            Match.objectLike({
              Name: 'PUDDLE_BACKEND_BASE_URL',
            }),
          ]),
          Secrets: Match.arrayWith([
            Match.objectLike({
              Name: 'LIVEKIT_API_KEY',
            }),
            Match.objectLike({
              Name: 'ANTHROPIC_API_KEY',
            }),
            Match.objectLike({
              Name: 'DEEPGRAM_API_KEY',
            }),
            Match.objectLike({
              Name: 'CARTESIA_API_KEY',
            }),
            Match.objectLike({
              Name: 'PUDDLE_BACKEND_INTERNAL_TOKEN',
            }),
          ]),
        }),
      ]),
    });
  });

  test('requires the backend service before deploying the platform container', () => {
    expect(() =>
      createStack({
        platform: {
          ...defaultConfig().platform,
          hosting: 'container',
        },
      }),
    ).toThrow('platformHosting=container requires deployBackendService=true.');
  });

  test('creates a public ECS platform service when enabled', () => {
    const stack = createStack({
      backend: {
        ...defaultConfig().backend,
        deployService: true,
        imageTag: 'backend-test',
      },
      platform: {
        ...defaultConfig().platform,
        hosting: 'container',
        imageTag: 'platform-test',
        domainName: 'app.usepuddle.com',
        certificateArn:
          'arn:aws:acm:us-east-1:111111111111:certificate/test-certificate',
      },
      liveKit: {
        recordingsEnabled: false,
        url: 'wss://livekit.example',
      },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ECS::Service', 2);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 2);
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 3);

    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Type: 'application',
      LoadBalancerAttributes: Match.arrayWith([
        Match.objectLike({
          Key: 'access_logs.s3.enabled',
          Value: 'true',
        }),
        Match.objectLike({
          Key: 'access_logs.s3.prefix',
          Value: 'platform-alb',
        }),
      ]),
    });
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'platform',
          Environment: Match.arrayWith([
            Match.objectLike({
              Name: 'NEXT_PUBLIC_SITE_URL',
              Value: 'https://app.usepuddle.com',
            }),
            Match.objectLike({
              Name: 'PUDDLE_ALLOWED_AUTH_DOMAINS',
              Value: 'usepuddle.com,workweave.ai',
            }),
          ]),
          Secrets: Match.arrayWith([
            Match.objectLike({
              Name: 'WORKOS_API_KEY',
            }),
            Match.objectLike({
              Name: 'WORKOS_COOKIE_PASSWORD',
            }),
            Match.objectLike({
              Name: 'PUDDLE_BACKEND_INTERNAL_TOKEN',
            }),
          ]),
        }),
      ]),
    });
  });

  test('injects Ashby onboarding admin bootstrap emails into platform tasks when configured', () => {
    const stack = createStack({
      backend: {
        ...defaultConfig().backend,
        deployService: true,
        imageTag: 'backend-test',
      },
      platform: {
        ...defaultConfig().platform,
        hosting: 'container',
        imageTag: 'platform-test',
        ashbyOnboardingAdminEmails: 'admin@usepuddle.com,owner@usepuddle.com',
      },
      liveKit: {
        recordingsEnabled: false,
        url: 'wss://livekit.example',
      },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'platform',
          Environment: Match.arrayWith([
            Match.objectLike({
              Name: 'PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS',
              Value: 'admin@usepuddle.com,owner@usepuddle.com',
            }),
          ]),
        }),
      ]),
    });
  });
});

function createStack(overrides: Partial<PuddleEnvConfig> = {}): InfraStack {
  const app = new cdk.App();
  const config = {
    ...defaultConfig(),
    ...overrides,
  };

  return new InfraStack(app, 'TestStack', {
    env: {
      account: config.account,
      region: config.region,
    },
    config,
  });
}

function defaultConfig(): PuddleEnvConfig {
  return {
    envName: 'dev',
    account: '111111111111',
    region: 'us-east-1',
    stackName: 'Puddle-VideoAgent-Infra',
    networkMode: 'private-tasks-public-alb',
    resourcePrefix: 'puddle-videoagent',
    vpc: {
      maxAzs: 2,
      natGateways: 1,
    },
    backend: {
      deployService: false,
      exposePublicly: false,
      requireAuth: true,
      port: 8080,
      desiredCount: 1,
      cpu: 256,
      memoryMiB: 512,
    },
    agent: {
      deployService: false,
      desiredCount: 1,
      cpu: 1024,
      memoryMiB: 2048,
      participantReconnectGraceSeconds: 300,
    },
    platform: {
      hosting: 'disabled',
      port: 3000,
      desiredCount: 1,
      cpu: 512,
      memoryMiB: 1024,
      allowedAuthDomains: 'usepuddle.com,workweave.ai',
      defaultScriptVersion: 'pilot-v1',
    },
    database: {
      external: false,
      name: 'puddle',
      username: 'puddle_app',
      instanceType: 't4g.micro',
      allocatedStorageGb: 20,
      maxAllocatedStorageGb: 100,
      backupRetentionDays: 7,
      multiAz: false,
      deletionProtection: false,
      allowRealCandidateDataExternal: false,
    },
    devTunnel: { enabled: true, instanceType: 't3.nano' },
    liveKit: {
      recordingsEnabled: false,
    },
    logs: {
      retentionDays: 30,
    },
    githubOidc: {
      enabled: false,
    },
  };
}
