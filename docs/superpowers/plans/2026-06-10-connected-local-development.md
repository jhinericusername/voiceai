# Connected Local Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-command localhost workflows that connect to deployed non-production Puddle resources.

**Architecture:** Keep `infra/` as the single infrastructure source of truth and add a dev-only SSM tunnel target inside the VPC. Add Node-based dev orchestration scripts that read CloudFormation outputs, fetch Secrets Manager values without printing them, open SSM port-forwarding sessions, and start the local platform/backend with the correct environment. Keep the default workflow local-platform-to-deployed-backend; make local-backend-to-deployed-resources the advanced backend workflow.

**Tech Stack:** AWS CDK v2, AWS CLI/SSM Session Manager, Node.js ES modules, pnpm workspace scripts, Next.js route handlers, Fastify backend.

---

## File Structure

- `infra/lib/config.ts`: add `devTunnel` environment config and CDK context parsing.
- `infra/lib/infra-stack.ts`: create the dev-only SSM tunnel EC2 instance, IAM role, security group ingress, and output.
- `infra/test/infra.test.ts`: assert the tunnel target exists for dev, can be disabled, and is blocked in prod.
- `scripts/dev/connected-dev.mjs`: shared Node helpers for AWS CLI calls, stack-output parsing, secret parsing, port checks, tunnel command construction, HTTP readiness, child process cleanup, and prod guardrails.
- `scripts/dev/dev-connected.mjs`: default workflow runner for local platform -> deployed dev backend.
- `scripts/dev/dev-backend-connected.mjs`: backend workflow runner for local backend -> deployed dev RDS/LiveKit plus local platform.
- `scripts/dev/connected-dev.test.mjs`: Node unit tests for pure script helpers.
- `package.json`: add `dev:connected`, `dev:backend:connected`, and `test:connected-dev` scripts.
- `platform/lib/backend-api.ts`: keep the shared backend URL/header helper.
- `platform/app/api/interviews/route.ts`: use the shared backend helper.
- `platform/app/api/interviews/[token]/join/route.ts`: use the shared backend helper.
- `platform/app/api/livekit/webhook/route.ts`: use the shared backend helper for URL resolution.
- `platform/tests/backend-api-helper.test.mjs`: static regression test that platform backend-proxy routes use the helper.
- `docs/RUNBOOK.md`: document the connected localhost workflows and prerequisites.

---

### Task 1: Add Dev Tunnel Infra Support

**Files:**
- Modify: `infra/lib/config.ts`
- Modify: `infra/lib/infra-stack.ts`
- Modify: `infra/test/infra.test.ts`

- [ ] **Step 1: Write failing infra tests**

Add these tests to `infra/test/infra.test.ts` before the platform tests:

```ts
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
              Match.objectLike({
                Ref: 'AWS::Partition',
              }),
              ':iam::aws:policy/AmazonSSMManagedInstanceCore',
            ]),
          ],
        },
      ]),
    });
    template.hasOutput('DevTunnelInstanceId', {});
  });

  test('can disable the dev SSM tunnel target', () => {
    const stack = createStack({
      devTunnel: {
        enabled: false,
        instanceType: 't3.nano',
      },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::Instance', 0);
  });

  test('blocks dev tunnel target in prod', () => {
    expect(() =>
      createStack({
        envName: 'prod',
        resourcePrefix: 'puddle-prod',
        vpc: {
          maxAzs: 2,
          natGateways: 2,
        },
        devTunnel: {
          enabled: true,
          instanceType: 't3.nano',
        },
        logs: {
          retentionDays: 90,
        },
      }),
    ).toThrow('Dev tunnel target is not allowed in prod.');
  });
```

Update the existing foundation test in the same file to expect the dev tunnel instance:

```ts
    template.resourceCountIs('AWS::EC2::Instance', 1);
```

Update `defaultConfig()` in `infra/test/infra.test.ts` to include:

```ts
    devTunnel: {
      enabled: true,
      instanceType: 't3.nano',
    },
```

- [ ] **Step 2: Run infra test to verify it fails**

Run:

```sh
cd infra && npm test -- --runInBand
```

Expected: FAIL because `PuddleEnvConfig` has no `devTunnel` property and the stack does not emit `DevTunnelInstanceId`.

- [ ] **Step 3: Add config shape and prod guard**

In `infra/lib/config.ts`, add this interface field to `PuddleEnvConfig` after `database`:

```ts
  devTunnel: {
    enabled: boolean;
    instanceType: string;
  };
```

In `configFromApp`, add this object after `database`:

```ts
    devTunnel: {
      enabled: readBooleanContext(app, 'enableDevTunnel', envName === 'dev'),
      instanceType: readStringContext(app, 'devTunnelInstanceType') ?? 't3.nano',
    },
```

In `infra/lib/infra-stack.ts`, add this interface near `PlatformDeployment`:

```ts
interface DevTunnelDeployment {
  instance: ec2.Instance;
}
```

In `validateConfig()`, add:

```ts
    if (this.cfg.envName === 'prod' && this.cfg.devTunnel.enabled) {
      throw new Error('Dev tunnel target is not allowed in prod.');
    }
```

- [ ] **Step 4: Create tunnel security group, instance, and output**

In `createSecurityGroups`, replace the current `return { ... }` block with an object variable so the dev tunnel group can be conditional:

```ts
    const groups: Record<string, ec2.SecurityGroup> = {
      backendTasks,
      backendLoadBalancer,
      platformLoadBalancer,
      platformTasks,
      agentTasks,
      futureDatabase,
    };

    if (this.cfg.devTunnel.enabled) {
      const devTunnel = new ec2.SecurityGroup(this, 'DevTunnelSecurityGroup', {
        vpc,
        securityGroupName: this.name('dev-tunnel-sg'),
        description: 'Developer SSM tunnel target. No inbound access.',
        allowAllOutbound: true,
      });
      backendLoadBalancer.addIngressRule(
        devTunnel,
        ec2.Port.tcp(80),
        'Backend load balancer access from developer SSM tunnel',
      );
      futureDatabase.addIngressRule(
        devTunnel,
        ec2.Port.tcp(5432),
        'Postgres from developer SSM tunnel',
      );
      groups.devTunnel = devTunnel;
    }

    return groups;
```

In the constructor, after `const cluster = new ecs.Cluster(...)`, add:

```ts
    const devTunnelDeployment = this.createDevTunnelDeployment({
      vpc,
      securityGroups,
    });
```

Pass `devTunnelDeployment` into `this.createOutputs({ ... })`.

Add this method before `createBackendDeployment`:

```ts
  private createDevTunnelDeployment(params: {
    vpc: ec2.IVpc;
    securityGroups: Record<string, ec2.ISecurityGroup>;
  }): DevTunnelDeployment | undefined {
    if (!this.cfg.devTunnel.enabled) {
      return undefined;
    }

    const securityGroup = params.securityGroups.devTunnel;
    if (!securityGroup) {
      throw new Error('Dev tunnel security group is required when dev tunnel is enabled.');
    }

    const role = new iam.Role(this, 'DevTunnelRole', {
      roleName: this.name('dev-tunnel-role'),
      description: `${this.cfg.envName} developer SSM tunnel target role.`,
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
      securityGroup,
      requireImdsv2: true,
    });
    cdk.Tags.of(instance).add('Name', this.name('dev-tunnel'));

    return { instance };
  }
```

Update the `createOutputs` parameter type to include:

```ts
    devTunnelDeployment?: DevTunnelDeployment;
```

Inside `createOutputs`, after the security group outputs, add:

```ts
    if (values.devTunnelDeployment) {
      new cdk.CfnOutput(this, 'DevTunnelInstanceId', {
        value: values.devTunnelDeployment.instance.instanceId,
      });
    }
```

- [ ] **Step 5: Run infra tests and build**

Run:

```sh
cd infra && npm test -- --runInBand
cd infra && npm run build
```

Expected: PASS and exit 0 for both commands.

- [ ] **Step 6: Commit infra task**

Run:

```sh
git add infra/lib/config.ts infra/lib/infra-stack.ts infra/test/infra.test.ts
git commit -m "feat: add dev SSM tunnel target"
```

Expected: commit succeeds.

---

### Task 2: Add Connected Dev Script Helpers

**Files:**
- Create: `scripts/dev/connected-dev.mjs`
- Create: `scripts/dev/connected-dev.test.mjs`

- [ ] **Step 1: Write failing helper tests**

Create `scripts/dev/connected-dev.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  backendHostFromBaseUrl,
  buildRemotePortForwardArgs,
  envList,
  outputValue,
  parseSecretString,
  requireNonProdEnvironment,
} from "./connected-dev.mjs";

const outputs = [
  { OutputKey: "EnvironmentName", OutputValue: "dev" },
  {
    OutputKey: "BackendInternalBaseUrl",
    OutputValue: "http://internal-backend.example.local",
  },
];

test("outputValue returns a named CloudFormation output", () => {
  assert.equal(outputValue(outputs, "EnvironmentName"), "dev");
});

test("outputValue throws with a useful message when output is missing", () => {
  assert.throws(() => outputValue(outputs, "MissingOutput"), /Missing stack output/);
});

test("backendHostFromBaseUrl strips protocol and path", () => {
  assert.equal(
    backendHostFromBaseUrl("http://internal-backend.example.local/healthz"),
    "internal-backend.example.local",
  );
});

test("parseSecretString returns raw string secrets by default", () => {
  assert.equal(parseSecretString("plain-secret"), "plain-secret");
});

test("parseSecretString can read JSON object keys", () => {
  assert.equal(parseSecretString('{"username":"puddle","password":"secret"}', "password"), "secret");
});

test("parseSecretString rejects missing JSON keys", () => {
  assert.throws(() => parseSecretString('{"username":"puddle"}', "password"), /missing key/);
});

test("buildRemotePortForwardArgs builds an SSM remote-host tunnel command", () => {
  assert.deepEqual(
    buildRemotePortForwardArgs({
      target: "i-123",
      remoteHost: "db.internal",
      remotePort: 5432,
      localPort: 15432,
    }),
    [
      "ssm",
      "start-session",
      "--target",
      "i-123",
      "--document-name",
      "AWS-StartPortForwardingSessionToRemoteHost",
      "--parameters",
      '{"host":["db.internal"],"portNumber":["5432"],"localPortNumber":["15432"]}',
    ],
  );
});

test("requireNonProdEnvironment allows dev and stage", () => {
  assert.equal(requireNonProdEnvironment("dev", {}), undefined);
  assert.equal(requireNonProdEnvironment("stage", {}), undefined);
});

test("requireNonProdEnvironment blocks prod without explicit override", () => {
  assert.throws(() => requireNonProdEnvironment("prod", {}), /Refusing production/);
});

test("envList removes empty env values", () => {
  assert.deepEqual(envList({ A: "one", B: "", C: undefined }), { A: "one" });
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```sh
node --test scripts/dev/connected-dev.test.mjs
```

Expected: FAIL because `scripts/dev/connected-dev.mjs` does not exist.

- [ ] **Step 3: Implement shared helper module**

Create `scripts/dev/connected-dev.mjs`:

```js
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";

export const DEFAULT_REGION = "us-west-1";
export const DEFAULT_STACK_NAME = "Puddle-VideoAgent-Infra";
export const DEFAULT_BACKEND_TUNNEL_PORT = 18080;
export const DEFAULT_DB_TUNNEL_PORT = 15432;
export const DEFAULT_BACKEND_PORT = 8080;

export function envList(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== ""),
  );
}

export function outputValue(outputs, key) {
  const found = outputs.find((output) => output.OutputKey === key);
  if (!found?.OutputValue) {
    throw new Error(`Missing stack output: ${key}`);
  }
  return found.OutputValue;
}

export function backendHostFromBaseUrl(baseUrl) {
  return new URL(baseUrl).hostname;
}

export function parseSecretString(secretString, key) {
  if (!key) {
    return secretString;
  }
  let parsed;
  try {
    parsed = JSON.parse(secretString);
  } catch (error) {
    throw new Error(`Secret is not JSON; cannot read key ${key}`);
  }
  const value = parsed?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Secret JSON is missing key ${key}`);
  }
  return value;
}

export function requireNonProdEnvironment(envName, env = process.env) {
  if (envName !== "prod") {
    return;
  }
  if (env.PUDDLE_ALLOW_PROD_CONNECTED_DEV === "I_UNDERSTAND_THIS_TARGETS_PRODUCTION") {
    return;
  }
  throw new Error(
    "Refusing production connected-dev target. Set PUDDLE_ALLOW_PROD_CONNECTED_DEV=I_UNDERSTAND_THIS_TARGETS_PRODUCTION to override.",
  );
}

export function buildRemotePortForwardArgs({ target, remoteHost, remotePort, localPort }) {
  return [
    "ssm",
    "start-session",
    "--target",
    target,
    "--document-name",
    "AWS-StartPortForwardingSessionToRemoteHost",
    "--parameters",
    JSON.stringify({
      host: [remoteHost],
      portNumber: [String(remotePort)],
      localPortNumber: [String(localPort)],
    }),
  ];
}

export function awsArgs(args, options) {
  const full = [...args, "--region", options.region];
  if (options.profile) {
    full.push("--profile", options.profile);
  }
  return full;
}

export function awsJson(args, options) {
  const result = spawnSync("aws", awsArgs(args, options), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `aws ${args.join(" ")} failed`);
  }
  return JSON.parse(result.stdout);
}

export function getStackOutputs(options) {
  const response = awsJson(
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      options.stackName,
      "--query",
      "Stacks[0].Outputs",
      "--output",
      "json",
    ],
    options,
  );
  if (!Array.isArray(response)) {
    throw new Error(`No CloudFormation outputs found for stack ${options.stackName}`);
  }
  return response;
}

export function getSecretString(secretId, options) {
  const response = awsJson(
    [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      secretId,
      "--query",
      "SecretString",
      "--output",
      "json",
    ],
    options,
  );
  if (typeof response !== "string" || response.length === 0) {
    throw new Error(`Secret ${secretId} is empty or unavailable`);
  }
  return response;
}

export async function assertPortAvailable(port, host = "127.0.0.1") {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Local port ${port} is already in use`)));
    server.once("listening", () => {
      server.close(resolve);
    });
    server.listen(port, host);
  });
}

export function startAwsTunnel({ args, options, label }) {
  const child = spawn("aws", awsArgs(args, options), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) console.log(`[${label}] ${text}`);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) console.error(`[${label}] ${text}`);
  });
  return child;
}

export function startProcess(command, args, { cwd, env, label }) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[${label}] exited via ${signal}`);
    } else if (code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
    }
  });
  return child;
}

export async function waitForHttpOk(url, { timeoutMs = 30000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = new Error(`Timed out waiting for ${url}`);
  while (Date.now() < deadline) {
    try {
      const statusCode = await httpStatus(url);
      if (statusCode >= 200 && statusCode < 300) {
        return;
      }
      lastError = new Error(`${url} returned HTTP ${statusCode}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw lastError;
}

function httpStatus(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.setTimeout(2000, () => {
      request.destroy(new Error(`Timed out connecting to ${url}`));
    });
  });
}

export function cleanupOnExit(children) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
  process.on("exit", cleanup);
  return cleanup;
}
```

- [ ] **Step 4: Run helper tests**

Run:

```sh
node --test scripts/dev/connected-dev.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit helper task**

Run:

```sh
git add scripts/dev/connected-dev.mjs scripts/dev/connected-dev.test.mjs
git commit -m "feat: add connected dev script helpers"
```

Expected: commit succeeds.

---

### Task 3: Add One-Command Connected Dev Runners

**Files:**
- Create: `scripts/dev/dev-connected.mjs`
- Create: `scripts/dev/dev-backend-connected.mjs`
- Modify: `package.json`
- Modify: `scripts/dev/connected-dev.test.mjs`

- [ ] **Step 1: Add failing runner command tests**

Append these tests to `scripts/dev/connected-dev.test.mjs`:

```js
import { readFile } from "node:fs/promises";

test("root package exposes connected dev commands", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["dev:connected"], "node scripts/dev/dev-connected.mjs");
  assert.equal(
    packageJson.scripts["dev:backend:connected"],
    "node scripts/dev/dev-backend-connected.mjs",
  );
  assert.equal(packageJson.scripts["test:connected-dev"], "node --test scripts/dev/connected-dev.test.mjs");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
node --test scripts/dev/connected-dev.test.mjs
```

Expected: FAIL because the root package scripts are missing.

- [ ] **Step 3: Add package scripts**

In the root `package.json`, add these scripts:

```json
    "dev:connected": "node scripts/dev/dev-connected.mjs",
    "dev:backend:connected": "node scripts/dev/dev-backend-connected.mjs",
    "test:connected-dev": "node --test scripts/dev/connected-dev.test.mjs"
```

- [ ] **Step 4: Create default connected platform runner**

Create `scripts/dev/dev-connected.mjs`:

```js
#!/usr/bin/env node
import {
  DEFAULT_BACKEND_TUNNEL_PORT,
  DEFAULT_REGION,
  DEFAULT_STACK_NAME,
  assertPortAvailable,
  backendHostFromBaseUrl,
  buildRemotePortForwardArgs,
  cleanupOnExit,
  envList,
  getSecretString,
  getStackOutputs,
  outputValue,
  parseSecretString,
  requireNonProdEnvironment,
  startAwsTunnel,
  startProcess,
  waitForHttpOk,
} from "./connected-dev.mjs";

const region = process.env.AWS_REGION ?? process.env.REGION ?? DEFAULT_REGION;
const profile = process.env.AWS_PROFILE;
const stackName = process.env.PUDDLE_STACK_NAME ?? DEFAULT_STACK_NAME;
const localBackendPort = Number(process.env.PUDDLE_CONNECTED_BACKEND_PORT ?? DEFAULT_BACKEND_TUNNEL_PORT);
const options = { region, profile, stackName };

console.log(`Using stack ${stackName} in ${region}`);
const outputs = getStackOutputs(options);
const envName = outputValue(outputs, "EnvironmentName");
requireNonProdEnvironment(envName);

const backendBaseUrl = outputValue(outputs, "BackendInternalBaseUrl");
const tunnelInstanceId = outputValue(outputs, "DevTunnelInstanceId");
const backendTokenSecretName = outputValue(outputs, "BackendInternalTokenSecretName");
const backendToken = parseSecretString(getSecretString(backendTokenSecretName, options));
const backendHost = backendHostFromBaseUrl(backendBaseUrl);

await assertPortAvailable(localBackendPort);
const backendTunnel = startAwsTunnel({
  label: "backend-tunnel",
  options,
  args: buildRemotePortForwardArgs({
    target: tunnelInstanceId,
    remoteHost: backendHost,
    remotePort: 80,
    localPort: localBackendPort,
  }),
});
const cleanup = cleanupOnExit([backendTunnel]);

try {
  const localBackendUrl = `http://127.0.0.1:${localBackendPort}`;
  await waitForHttpOk(`${localBackendUrl}/healthz`);
  const platform = startProcess("corepack", ["pnpm@9.12.0", "--filter", "@puddle/platform", "dev"], {
    label: "platform",
    env: envList({
      PUDDLE_BACKEND_BASE_URL: localBackendUrl,
      PUDDLE_BACKEND_INTERNAL_TOKEN: backendToken,
    }),
  });
  cleanupOnExit([backendTunnel, platform]);
  platform.on("exit", (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
} catch (error) {
  cleanup();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
```

- [ ] **Step 5: Create connected backend runner**

Create `scripts/dev/dev-backend-connected.mjs`:

```js
#!/usr/bin/env node
import {
  DEFAULT_BACKEND_PORT,
  DEFAULT_DB_TUNNEL_PORT,
  DEFAULT_REGION,
  DEFAULT_STACK_NAME,
  assertPortAvailable,
  buildRemotePortForwardArgs,
  cleanupOnExit,
  envList,
  getSecretString,
  getStackOutputs,
  outputValue,
  parseSecretString,
  requireNonProdEnvironment,
  startAwsTunnel,
  startProcess,
  waitForHttpOk,
} from "./connected-dev.mjs";

const region = process.env.AWS_REGION ?? process.env.REGION ?? DEFAULT_REGION;
const profile = process.env.AWS_PROFILE;
const stackName = process.env.PUDDLE_STACK_NAME ?? DEFAULT_STACK_NAME;
const dbLocalPort = Number(process.env.PUDDLE_CONNECTED_DB_PORT ?? DEFAULT_DB_TUNNEL_PORT);
const backendPort = Number(process.env.PORT ?? DEFAULT_BACKEND_PORT);
const options = { region, profile, stackName };

console.log(`Using stack ${stackName} in ${region}`);
const outputs = getStackOutputs(options);
const envName = outputValue(outputs, "EnvironmentName");
requireNonProdEnvironment(envName);

const tunnelInstanceId = outputValue(outputs, "DevTunnelInstanceId");
const dbHost = outputValue(outputs, "DatabaseInstanceEndpointAddress");
const dbPort = Number(outputValue(outputs, "DatabaseInstanceEndpointPort"));
const dbName = outputValue(outputs, "DatabaseName");
const dbSecretName = outputValue(outputs, "DatabaseCredentialsSecretName");
const liveKitUrl = process.env.LIVEKIT_URL;
if (!liveKitUrl) {
  throw new Error("LIVEKIT_URL must be set in your shell or root .env.local for local backend mode.");
}

const dbSecret = getSecretString(dbSecretName, options);
const backendToken = parseSecretString(
  getSecretString(outputValue(outputs, "BackendInternalTokenSecretName"), options),
);
const liveKitApiKey = parseSecretString(
  getSecretString(outputValue(outputs, "LivekitApiKeySecretName"), options),
);
const liveKitApiSecret = parseSecretString(
  getSecretString(outputValue(outputs, "LivekitApiSecretSecretName"), options),
);

await assertPortAvailable(dbLocalPort);
await assertPortAvailable(backendPort);
const dbTunnel = startAwsTunnel({
  label: "rds-tunnel",
  options,
  args: buildRemotePortForwardArgs({
    target: tunnelInstanceId,
    remoteHost: dbHost,
    remotePort: dbPort,
    localPort: dbLocalPort,
  }),
});
const cleanup = cleanupOnExit([dbTunnel]);

try {
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const backend = startProcess("corepack", ["pnpm@9.12.0", "--filter", "@puddle/backend", "dev"], {
    label: "backend",
    env: envList({
      PORT: String(backendPort),
      DATABASE_HOST: "127.0.0.1",
      DATABASE_PORT: String(dbLocalPort),
      DATABASE_NAME: dbName,
      DATABASE_USER: parseSecretString(dbSecret, "username"),
      DATABASE_PASSWORD: parseSecretString(dbSecret, "password"),
      DATABASE_SSL: "true",
      DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
      LIVEKIT_URL: liveKitUrl,
      LIVEKIT_API_KEY: liveKitApiKey,
      LIVEKIT_API_SECRET: liveKitApiSecret,
      PUDDLE_BACKEND_INTERNAL_TOKEN: backendToken,
    }),
  });
  await waitForHttpOk(`${backendUrl}/healthz`);
  const platform = startProcess("corepack", ["pnpm@9.12.0", "--filter", "@puddle/platform", "dev"], {
    label: "platform",
    env: envList({
      PUDDLE_BACKEND_BASE_URL: backendUrl,
      PUDDLE_BACKEND_INTERNAL_TOKEN: backendToken,
    }),
  });
  cleanupOnExit([dbTunnel, backend, platform]);
  backend.on("exit", (code) => {
    cleanup();
    platform.kill("SIGTERM");
    process.exit(code ?? 0);
  });
  platform.on("exit", (code) => {
    cleanup();
    backend.kill("SIGTERM");
    process.exit(code ?? 0);
  });
} catch (error) {
  cleanup();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
```

- [ ] **Step 6: Run script tests**

Run:

```sh
node --test scripts/dev/connected-dev.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit runner task**

Run:

```sh
git add package.json scripts/dev/dev-connected.mjs scripts/dev/dev-backend-connected.mjs scripts/dev/connected-dev.test.mjs
git commit -m "feat: add connected local dev runners"
```

Expected: commit succeeds.

---

### Task 4: Consolidate Platform Backend Helpers

**Files:**
- Modify: `platform/app/api/interviews/route.ts`
- Modify: `platform/app/api/interviews/[token]/join/route.ts`
- Modify: `platform/app/api/livekit/webhook/route.ts`
- Create: `platform/tests/backend-api-helper.test.mjs`

- [ ] **Step 1: Write failing static regression test**

Create `platform/tests/backend-api-helper.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeFiles = [
  "app/api/interviews/route.ts",
  "app/api/interviews/[token]/join/route.ts",
  "app/api/livekit/webhook/route.ts",
];

test("backend proxy routes share backend-api helpers", async () => {
  for (const routeFile of routeFiles) {
    const source = await readFile(new URL(`../${routeFile}`, import.meta.url), "utf8");
    assert.match(source, /@\/lib\/backend-api/);
    assert.equal(source.includes("function backendBaseUrl"), false, routeFile);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```sh
node --test platform/tests/backend-api-helper.test.mjs
```

Expected: FAIL because the route files still define local `backendBaseUrl` helpers.

- [ ] **Step 3: Update create interview route**

In `platform/app/api/interviews/route.ts`, add:

```ts
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";
```

Remove the local `backendBaseUrl()` and `backendHeaders()` functions. Keep the existing fetch call unchanged except that it now uses the imported helpers.

- [ ] **Step 4: Update candidate join route**

In `platform/app/api/interviews/[token]/join/route.ts`, add:

```ts
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";
```

Remove the local `backendBaseUrl()` and `backendHeaders()` functions. Replace the fetch headers block with:

```ts
      headers: backendHeaders(),
```

- [ ] **Step 5: Update LiveKit webhook route**

In `platform/app/api/livekit/webhook/route.ts`, add:

```ts
import { backendBaseUrl } from "@/lib/backend-api";
```

Remove the local `backendBaseUrl()` function.

- [ ] **Step 6: Run platform helper test and lint**

Run:

```sh
node --test platform/tests/backend-api-helper.test.mjs
corepack pnpm@9.12.0 --filter @puddle/platform lint
```

Expected: PASS and exit 0.

- [ ] **Step 7: Commit helper consolidation task**

Run:

```sh
git add platform/app/api/interviews/route.ts 'platform/app/api/interviews/[token]/join/route.ts' platform/app/api/livekit/webhook/route.ts platform/tests/backend-api-helper.test.mjs
git commit -m "refactor: share platform backend API helpers"
```

Expected: commit succeeds.

---

### Task 5: Document Connected Local Workflows

**Files:**
- Modify: `docs/RUNBOOK.md`
- Modify: `infra/README.md`

- [ ] **Step 1: Add failing documentation checks**

Append these tests to `scripts/dev/connected-dev.test.mjs`:

```js
test("runbook documents connected local development commands", async () => {
  const runbook = await readFile(new URL("../../docs/RUNBOOK.md", import.meta.url), "utf8");
  assert.match(runbook, /pnpm dev:connected/);
  assert.match(runbook, /pnpm dev:backend:connected/);
  assert.match(runbook, /DevTunnelInstanceId/);
});

test("infra readme documents the dev tunnel target", async () => {
  const readme = await readFile(new URL("../../infra/README.md", import.meta.url), "utf8");
  assert.match(readme, /enableDevTunnel/);
  assert.match(readme, /DevTunnelInstanceId/);
});
```

- [ ] **Step 2: Run docs tests to verify they fail**

Run:

```sh
node --test scripts/dev/connected-dev.test.mjs
```

Expected: FAIL because the docs do not yet mention the new commands and outputs.

- [ ] **Step 3: Update runbook**

In `docs/RUNBOOK.md`, replace the current "Backend API server" subsection under "6. Run locally" with:

```md
### Connected platform against deployed dev

Use this for the normal product/UI workflow. It runs the platform locally and
forwards backend calls to the deployed dev backend through AWS SSM:

```bash
AWS_PROFILE=<dev-profile> pnpm dev:connected
```

Prerequisites:

- AWS CLI authenticated to the dev account.
- Session Manager plugin installed.
- The dev stack has `DevTunnelInstanceId` and `BackendInternalBaseUrl` outputs.
- `platform/.env.local` contains local WorkOS and site URL values.

The command starts a local tunnel on `127.0.0.1:18080` by default and runs the
platform with `PUDDLE_BACKEND_BASE_URL=http://127.0.0.1:18080`. Override the
tunnel port with `PUDDLE_CONNECTED_BACKEND_PORT`.

### Connected local backend against deployed dev resources

Use this only when changing backend code. It runs the backend locally while
forwarding Postgres traffic to the deployed dev RDS instance:

```bash
AWS_PROFILE=<dev-profile> LIVEKIT_URL=<wss://dev-livekit-host> pnpm dev:backend:connected
```

The command starts an RDS tunnel on `127.0.0.1:15432`, runs the backend on
`127.0.0.1:8080`, and starts the platform pointed at that local backend.
Override ports with `PUDDLE_CONNECTED_DB_PORT` and `PORT`.

Do not run migrations automatically from these workflows. Database migrations
remain a manual-gate operation.

### Backend API server without deployed resources
```

Keep the existing backend API server command under that new subsection.

- [ ] **Step 4: Update infra README**

In `infra/README.md`, add `enableDevTunnel=true|false` and `devTunnelInstanceType=t3.nano` to the Useful Context Flags list.

After the backend deployment section, add:

```md
## Connected Local Development

Dev stacks create a small private EC2 instance for AWS SSM port forwarding by
default. The instance has no SSH ingress and uses the
`AmazonSSMManagedInstanceCore` policy. CDK emits `DevTunnelInstanceId`; local
scripts use it to forward:

- local platform traffic to `BackendInternalBaseUrl`,
- local backend database traffic to the private RDS endpoint.

Disable it with `-c enableDevTunnel=false`. The tunnel target is blocked for
`envName=prod`.
```

- [ ] **Step 5: Run docs tests**

Run:

```sh
node --test scripts/dev/connected-dev.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit docs task**

Run:

```sh
git add docs/RUNBOOK.md infra/README.md scripts/dev/connected-dev.test.mjs
git commit -m "docs: add connected local dev runbook"
```

Expected: commit succeeds.

---

### Task 6: Final Verification

**Files:**
- Verify all files changed by Tasks 1-5.

- [ ] **Step 1: Run script tests**

Run:

```sh
node --test scripts/dev/connected-dev.test.mjs
node --test platform/tests/backend-api-helper.test.mjs
```

Expected: PASS and exit 0.

- [ ] **Step 2: Run infra tests and build**

Run:

```sh
cd infra && npm test -- --runInBand
cd infra && npm run build
```

Expected: PASS and exit 0.

- [ ] **Step 3: Run platform lint**

Run:

```sh
corepack pnpm@9.12.0 --filter @puddle/platform lint
```

Expected: PASS and exit 0.

- [ ] **Step 4: Run backend tests impacted by env/helper work**

Run:

```sh
corepack pnpm@9.12.0 --filter @puddle/backend test
```

Expected: PASS and exit 0.

- [ ] **Step 5: Review final diff**

Run:

```sh
git status --short
git log --oneline -6
```

Expected: only pre-existing unrelated dirty worktree files remain unstaged; implementation commits from this plan are present.

- [ ] **Step 6: Final code review**

Dispatch a final code-review subagent over all implementation commits for this plan. Fix any blocking findings before reporting completion.
