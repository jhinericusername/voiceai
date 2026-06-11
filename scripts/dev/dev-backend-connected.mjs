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
  parseTcpPort,
  parseSecretString,
  requireNonProdEnvironment,
  startAwsTunnel,
  startProcess,
  waitForHttpOk,
} from "./connected-dev.mjs";

const region = process.env.AWS_REGION ?? process.env.REGION ?? DEFAULT_REGION;
const profile = process.env.AWS_PROFILE;
const stackName = process.env.PUDDLE_STACK_NAME ?? DEFAULT_STACK_NAME;
const dbLocalPort = parseTcpPort(
  process.env.PUDDLE_CONNECTED_DB_PORT,
  "PUDDLE_CONNECTED_DB_PORT",
  DEFAULT_DB_TUNNEL_PORT,
);
const backendPort = parseTcpPort(process.env.PORT, "PORT", DEFAULT_BACKEND_PORT);
const options = { region, profile, stackName };
const children = [];
const cleanup = cleanupOnExit(children);
let exiting = false;

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
  const liveKitUrl = process.env.LIVEKIT_URL;
  if (!liveKitUrl) {
    throw new Error("LIVEKIT_URL must be set for local backend connected development.");
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
  const backendTokenSecretName = outputValue(outputs, "BackendInternalTokenSecretName");
  const liveKitApiKeySecretName = outputValue(outputs, "LivekitApiKeySecretName");
  const liveKitApiSecretSecretName = outputValue(outputs, "LivekitApiSecretSecretName");

  const dbSecret = getSecretString(dbSecretName, options);
  const backendToken = parseSecretString(getSecretString(backendTokenSecretName, options));
  const liveKitApiKey = parseSecretString(getSecretString(liveKitApiKeySecretName, options));
  const liveKitApiSecret = parseSecretString(getSecretString(liveKitApiSecretSecretName, options));

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
    onError: fail,
  });
  children.push(dbTunnel);
  dbTunnel.on("exit", (code, signal) => {
    exitAfterChild("rds-tunnel", code, signal);
  });

  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const backend = startProcess(
    "corepack",
    ["pnpm@9.12.0", "--filter", "@puddle/backend", "dev"],
    {
      label: "backend",
      env: {
        ...envList({
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
        DATABASE_URL: "",
      },
      onError: fail,
    },
  );
  children.push(backend);
  backend.on("exit", (code, signal) => {
    exitAfterChild("backend", code, signal, { allowZero: true });
  });

  await waitForHttpOk(`${backendUrl}/healthz`);

  const platform = startProcess(
    "corepack",
    ["pnpm@9.12.0", "--filter", "@puddle/platform", "dev"],
    {
      label: "platform",
      env: envList({
        PUDDLE_BACKEND_BASE_URL: backendUrl,
        PUDDLE_BACKEND_INTERNAL_TOKEN: backendToken,
      }),
      onError: fail,
    },
  );
  children.push(platform);
  platform.on("exit", (code, signal) => {
    exitAfterChild("platform", code, signal, { allowZero: true });
  });
} catch (error) {
  fail(error);
}
