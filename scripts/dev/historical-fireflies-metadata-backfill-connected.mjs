#!/usr/bin/env node
import {
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
  parseTcpPort,
  requireNonProdEnvironment,
  startAwsTunnel,
  startProcess,
  waitForTcpOpen,
} from "./connected-dev.mjs";

const region = process.env.AWS_REGION ?? process.env.REGION ?? DEFAULT_REGION;
const profile = process.env.AWS_PROFILE;
const stackName = process.env.PUDDLE_STACK_NAME ?? DEFAULT_STACK_NAME;
const dbLocalPort = parseTcpPort(
  process.env.PUDDLE_CONNECTED_DB_PORT,
  "PUDDLE_CONNECTED_DB_PORT",
  DEFAULT_DB_TUNNEL_PORT,
);
const backfillArgs = process.argv[2] === "--" ? process.argv.slice(3) : process.argv.slice(2);
const options = { region, profile, stackName };
const children = [];
const cleanup = cleanupOnExit(children);
let exiting = false;
let backfillStarted = false;

function fail(error) {
  if (exiting) return;
  exiting = true;
  cleanup();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function exitAfterChild(label, code, signal, { allowZero = false } = {}) {
  if (exiting) return;
  exiting = true;
  cleanup();

  if (allowZero && code === 0 && !signal) {
    process.exit(0);
  }

  const status = signal ? `signal ${signal}` : `code ${code ?? 0}`;
  console.error(`[${label}] exited unexpectedly with ${status}`);
  process.exit(code && code !== 0 ? code : 1);
}

function hasValueFlag(args, name) {
  return args.includes(name);
}

try {
  if (!hasValueFlag(backfillArgs, "--org-id")) {
    throw new Error("--org-id is required");
  }

  console.log(`Using stack ${stackName} in ${region}`);
  const outputs = getStackOutputs(options);
  const envName = outputValue(outputs, "EnvironmentName");
  requireNonProdEnvironment(envName);

  const tunnelInstanceId = outputValue(outputs, "DevTunnelInstanceId");
  const dbHost = outputValue(outputs, "DatabaseInstanceEndpointAddress");
  const dbPort = parseTcpPort(
    outputValue(outputs, "DatabaseInstanceEndpointPort"),
    "DatabaseInstanceEndpointPort",
    5432,
  );
  const dbName = outputValue(outputs, "DatabaseName");
  const dbSecretName = outputValue(outputs, "DatabaseCredentialsSecretName");
  const sourceBucket = outputValue(outputs, "WeaveHistoricalRecordingsBucketName");
  const sourceRegion = outputValue(outputs, "WeaveHistoricalRecordingsBucketRegion");
  const sourcePrefix = outputValue(outputs, "WeaveHistoricalRecordingsPrefix");
  const targetBucket = outputValue(outputs, "ArtifactsBucketName");
  const dbSecret = getSecretString(dbSecretName, options);

  await assertPortAvailable(dbLocalPort);

  const dbTunnel = startAwsTunnel({
    label: "rds-tunnel",
    options,
    args: buildRemotePortForwardArgs({
      target: tunnelInstanceId,
      remoteHost: dbHost,
      remotePort: dbPort,
      localPort: dbLocalPort,
    }),
    onError: fail,
  });
  children.push(dbTunnel);
  dbTunnel.on("exit", (code, signal) => {
    if (backfillStarted && code === 0 && !signal) {
      console.warn("[rds-tunnel] exited with code 0 after backfill startup; continuing.");
      return;
    }
    exitAfterChild("rds-tunnel", code, signal);
  });

  await waitForTcpOpen(dbLocalPort);

  const backendDir = new URL("../../backend/", import.meta.url);
  const backfill = startProcess(
    "node",
    [
      "--env-file=../.env.local",
      "--import",
      "tsx",
      "src/weave/fireflies/historical-import.ts",
      "--metadata-only",
      ...backfillArgs,
    ],
    {
      cwd: backendDir,
      label: "historical-fireflies-metadata-backfill",
      env: {
        ...envList({
          DATABASE_HOST: "127.0.0.1",
          DATABASE_PORT: String(dbLocalPort),
          DATABASE_NAME: dbName,
          DATABASE_USER: parseSecretString(dbSecret, "username"),
          DATABASE_PASSWORD: parseSecretString(dbSecret, "password"),
          DATABASE_SSL: "true",
          DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
          WEAVE_HISTORICAL_RECORDINGS_BUCKET: sourceBucket,
          WEAVE_HISTORICAL_RECORDINGS_REGION: sourceRegion,
          WEAVE_HISTORICAL_RECORDINGS_PREFIX: sourcePrefix,
          PUDDLE_ARTIFACTS_BUCKET: targetBucket,
          PUDDLE_ARTIFACTS_REGION: region,
          AWS_REGION: region,
        }),
        DATABASE_URL: "",
      },
      onError: fail,
    },
  );
  backfillStarted = true;
  children.push(backfill);
  backfill.on("exit", (code, signal) => {
    exitAfterChild("historical-fireflies-metadata-backfill", code, signal, { allowZero: true });
  });
} catch (error) {
  fail(error);
}
