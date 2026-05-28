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
    template.resourceCountIs('AWS::SecretsManager::Secret', 11);
    template.resourceCountIs('AWS::Logs::LogGroup', 4);
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
    template.resourceCountIs('AWS::RDS::DBSubnetGroup', 1);

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

  test('creates an internal ECS backend service when enabled', () => {
    const stack = createStack({
      backend: {
        ...defaultConfig().backend,
        deployService: true,
        imageTag: 'test',
      },
      liveKit: {
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

  test('blocks agent deployment and static platform hosting during this pass', () => {
    expect(() =>
      createStack({
        agent: {
          ...defaultConfig().agent,
          deployService: true,
        },
      }),
    ).toThrow('Agent service deployment is blocked');

    expect(() =>
      createStack({
        platform: {
          ...defaultConfig().platform,
          hosting: 'static-export',
        },
      }),
    ).toThrow('Static platform hosting is not implemented yet.');
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
    liveKit: {},
    logs: {
      retentionDays: 30,
    },
    githubOidc: {
      enabled: false,
    },
  };
}
