import * as cdk from 'aws-cdk-lib';

export type EnvName = 'dev' | 'stage' | 'prod';
export type NetworkMode = 'private-tasks-public-alb';
export type PlatformHosting = 'container' | 'static-export' | 'disabled';

export interface PuddleEnvConfig {
  envName: EnvName;
  account?: string;
  region: string;
  stackName: string;
  domainName?: string;
  networkMode: NetworkMode;
  resourcePrefix: string;
  vpc: {
    maxAzs: number;
    natGateways: number;
  };
  backend: {
    deployService: boolean;
    exposePublicly: boolean;
    requireAuth: boolean;
    imageTag?: string;
    port: number;
    desiredCount: number;
    cpu: number;
    memoryMiB: number;
  };
  agent: {
    deployService: boolean;
    imageTag?: string;
    desiredCount: number;
    cpu: number;
    memoryMiB: number;
    participantReconnectGraceSeconds: number;
  };
  platform: {
    hosting: PlatformHosting;
    imageTag?: string;
    port: number;
    desiredCount: number;
    cpu: number;
    memoryMiB: number;
    domainName?: string;
    certificateArn?: string;
    allowedAuthDomains: string;
    ashbyOnboardingAdminEmails?: string;
    defaultScriptVersion: string;
  };
  database: {
    external: boolean;
    name: string;
    username: string;
    instanceType: string;
    allocatedStorageGb: number;
    maxAllocatedStorageGb: number;
    backupRetentionDays: number;
    multiAz: boolean;
    deletionProtection: boolean;
    allowRealCandidateDataExternal: boolean;
  };
  devTunnel: {
    enabled: boolean;
    instanceType: string;
  };
  liveKit: {
    url?: string;
    recordingsEnabled: boolean;
    egressAssumeRoleArn?: string;
    egressAssumeRoleExternalId?: string;
  };
  logs: {
    retentionDays: number;
  };
  githubOidc: {
    enabled: boolean;
    owner?: string;
    repo?: string;
    providerArn?: string;
  };
}

const ENV_NAMES: readonly EnvName[] = ['dev', 'stage', 'prod'];
const PLATFORM_HOSTING_VALUES: readonly PlatformHosting[] = [
  'container',
  'static-export',
  'disabled',
];

export function configFromApp(app: cdk.App): PuddleEnvConfig {
  const envName = readEnumContext(app, 'envName', ENV_NAMES, 'dev');
  const account = readStringContext(app, 'account');
  const region = readStringContext(app, 'region') ?? 'us-west-1';

  return {
    envName,
    account,
    region,
    stackName: readStringContext(app, 'stackName') ?? 'Puddle-VideoAgent-Infra',
    domainName: readStringContext(app, 'domainName'),
    networkMode: 'private-tasks-public-alb',
    resourcePrefix: readStringContext(app, 'resourcePrefix') ?? 'puddle-videoagent',
    vpc: {
      maxAzs: readNumberContext(app, 'maxAzs', 2),
      natGateways: readNumberContext(
        app,
        'natGateways',
        envName === 'prod' ? 2 : 1,
      ),
    },
    backend: {
      deployService: readBooleanContext(app, 'deployBackendService', false),
      exposePublicly: readBooleanContext(app, 'exposeBackendPublicly', false),
      requireAuth: readBooleanContext(app, 'requireBackendAuth', true),
      imageTag: readStringContext(app, 'backendImageTag'),
      port: readNumberContext(app, 'backendPort', 8080),
      desiredCount: readNumberContext(app, 'backendDesiredCount', 1),
      cpu: readNumberContext(app, 'backendCpu', 256),
      memoryMiB: readNumberContext(app, 'backendMemoryMiB', 512),
    },
    agent: {
      deployService: readBooleanContext(app, 'deployAgentService', false),
      imageTag: readStringContext(app, 'agentImageTag'),
      desiredCount: readNumberContext(app, 'agentDesiredCount', 1),
      cpu: readNumberContext(app, 'agentCpu', 1024),
      memoryMiB: readNumberContext(app, 'agentMemoryMiB', 2048),
      participantReconnectGraceSeconds: readNumberContext(
        app,
        'participantReconnectGraceSeconds',
        300,
      ),
    },
    platform: {
      hosting: readEnumContext(
        app,
        'platformHosting',
        PLATFORM_HOSTING_VALUES,
        'disabled',
      ),
      imageTag: readStringContext(app, 'platformImageTag'),
      port: readNumberContext(app, 'platformPort', 3000),
      desiredCount: readNumberContext(app, 'platformDesiredCount', 1),
      cpu: readNumberContext(app, 'platformCpu', 512),
      memoryMiB: readNumberContext(app, 'platformMemoryMiB', 1024),
      domainName: readStringContext(app, 'platformDomainName'),
      certificateArn: readStringContext(app, 'platformCertificateArn'),
      allowedAuthDomains:
        readStringContext(app, 'platformAllowedAuthDomains') ??
        'usepuddle.com,workweave.ai',
      ashbyOnboardingAdminEmails: readStringContext(
        app,
        'platformAshbyOnboardingAdminEmails',
      ),
      defaultScriptVersion:
        readStringContext(app, 'platformDefaultScriptVersion') ?? 'pilot-v1',
    },
    database: {
      external: readBooleanContext(app, 'useExternalDatabase', false),
      name: readStringContext(app, 'databaseName') ?? 'puddle',
      username: readStringContext(app, 'databaseUsername') ?? 'puddle_app',
      instanceType:
        readStringContext(app, 'databaseInstanceType') ??
        (envName === 'prod' ? 't4g.small' : 't4g.micro'),
      allocatedStorageGb: readNumberContext(app, 'databaseAllocatedStorageGb', 20),
      maxAllocatedStorageGb: readNumberContext(app, 'databaseMaxAllocatedStorageGb', 100),
      backupRetentionDays: readNumberContext(
        app,
        'databaseBackupRetentionDays',
        envName === 'prod' ? 30 : 7,
      ),
      multiAz: readBooleanContext(app, 'databaseMultiAz', envName === 'prod'),
      deletionProtection: readBooleanContext(
        app,
        'databaseDeletionProtection',
        envName === 'prod',
      ),
      allowRealCandidateDataExternal: readBooleanContext(
        app,
        'allowRealCandidateDataOnExternalDatabase',
        false,
      ),
    },
    devTunnel: {
      enabled: readBooleanContext(app, 'enableDevTunnel', envName === 'dev'),
      instanceType: readStringContext(app, 'devTunnelInstanceType') ?? 't3.nano',
    },
    liveKit: {
      url: readStringContext(app, 'liveKitUrl'),
      recordingsEnabled: readBooleanContext(app, 'enableLiveKitRecordings', false),
      egressAssumeRoleArn: readStringContext(app, 'liveKitEgressAssumeRoleArn'),
      egressAssumeRoleExternalId: readStringContext(
        app,
        'liveKitEgressAssumeRoleExternalId',
      ),
    },
    logs: {
      retentionDays: readNumberContext(
        app,
        'logRetentionDays',
        envName === 'prod' ? 90 : 30,
      ),
    },
    githubOidc: {
      enabled: readBooleanContext(app, 'enableGithubOidc', false),
      owner: readStringContext(app, 'githubOwner'),
      repo: readStringContext(app, 'githubRepo'),
      providerArn: readStringContext(app, 'githubOidcProviderArn'),
    },
  };
}

function readStringContext(app: cdk.App, key: string): string | undefined {
  const value = app.node.tryGetContext(key);
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return String(value);
}

function readBooleanContext(
  app: cdk.App,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = app.node.tryGetContext(key);
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'n'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean CDK context value for ${key}: ${value}`);
}

function readNumberContext(
  app: cdk.App,
  key: string,
  defaultValue: number,
): number {
  const value = app.node.tryGetContext(key);
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer CDK context value for ${key}: ${value}`);
  }

  return parsed;
}

function readEnumContext<T extends string>(
  app: cdk.App,
  key: string,
  allowedValues: readonly T[],
  defaultValue: T,
): T {
  const value = readStringContext(app, key);
  if (value === undefined) {
    return defaultValue;
  }

  if (allowedValues.includes(value as T)) {
    return value as T;
  }

  throw new Error(
    `Invalid CDK context value for ${key}: ${value}. Expected one of ${allowedValues.join(
      ', ',
    )}.`,
  );
}
