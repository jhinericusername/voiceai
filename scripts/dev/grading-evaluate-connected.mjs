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

const stackRegion = process.env.AWS_REGION ?? process.env.REGION ?? DEFAULT_REGION;
const gradingRegion = process.env.PUDDLE_GRADING_BEDROCK_REGION ?? "us-east-1";
const profile = process.env.AWS_PROFILE;
const stackName = process.env.PUDDLE_STACK_NAME ?? DEFAULT_STACK_NAME;
const dbLocalPort = parseTcpPort(
  process.env.PUDDLE_CONNECTED_DB_PORT,
  "PUDDLE_CONNECTED_DB_PORT",
  DEFAULT_DB_TUNNEL_PORT,
);
const evaluatorArgs =
  process.argv[2] === "--" ? process.argv.slice(3) : process.argv.slice(2);
const options = { region: stackRegion, profile, stackName };
const children = [];
const cleanup = cleanupOnExit(children);
let exiting = false;
let evaluatorStarted = false;

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

try {
  console.log(`Using stack ${stackName} in ${stackRegion}`);
  console.log(`Using grading model region ${gradingRegion}`);

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
  const weaveDbSecretName = outputValue(outputs, "WeaveDatabaseCredentialsSecretName");

  const dbSecret = getSecretString(dbSecretName, options);
  const weaveDbSecret = getSecretString(weaveDbSecretName, options);

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
    if (evaluatorStarted && code === 0 && !signal) {
      console.warn("[rds-tunnel] exited with code 0 after evaluator startup; continuing.");
      return;
    }
    exitAfterChild("rds-tunnel", code, signal);
  });

  await waitForTcpOpen(dbLocalPort);

  const evaluator = startProcess(
    "corepack",
    [
      "pnpm@9.12.0",
      "--filter",
      "@puddle/backend",
      "grading:evaluate",
      "--",
      ...evaluatorArgs,
    ],
    {
      label: "grading-evaluate",
      env: {
        ...envList({
          DATABASE_HOST: "127.0.0.1",
          DATABASE_PORT: String(dbLocalPort),
          DATABASE_NAME: dbName,
          DATABASE_USER: parseSecretString(dbSecret, "username"),
          DATABASE_PASSWORD: parseSecretString(dbSecret, "password"),
          DATABASE_SSL: "true",
          DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
          WEAVE_DATABASE_HOST: "127.0.0.1",
          WEAVE_DATABASE_PORT: String(dbLocalPort),
          WEAVE_DATABASE_NAME: "weave",
          WEAVE_DATABASE_USER: parseSecretString(weaveDbSecret, "username"),
          WEAVE_DATABASE_PASSWORD: parseSecretString(weaveDbSecret, "password"),
          WEAVE_DATABASE_SSL: "true",
          WEAVE_DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
          AWS_REGION: gradingRegion,
        }),
        DATABASE_URL: "",
        WEAVE_DATABASE_URL: "",
      },
      onError: fail,
    },
  );
  evaluatorStarted = true;
  children.push(evaluator);
  evaluator.on("exit", (code, signal) => {
    exitAfterChild("grading-evaluate", code, signal, { allowZero: true });
  });
} catch (error) {
  fail(error);
}
