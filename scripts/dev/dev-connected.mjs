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
const localBackendPort = parseTcpPort(
  process.env.PUDDLE_CONNECTED_BACKEND_PORT,
  "PUDDLE_CONNECTED_BACKEND_PORT",
  DEFAULT_BACKEND_TUNNEL_PORT,
);
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

function removeChild(child) {
  const index = children.indexOf(child);
  if (index >= 0) {
    children.splice(index, 1);
  }
}

try {
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
  function startBackendTunnel() {
    const backendTunnel = startAwsTunnel({
      label: "backend-tunnel",
      options,
      args: buildRemotePortForwardArgs({
        target: tunnelInstanceId,
        remoteHost: backendHost,
        remotePort: 80,
        localPort: localBackendPort,
      }),
      onError: fail,
    });
    children.push(backendTunnel);
    backendTunnel.on("exit", (code, signal) => {
      removeChild(backendTunnel);
      if (!exiting && code === 0 && !signal) {
        console.warn("[backend-tunnel] exited with code 0; restarting.");
        startBackendTunnel();
        return;
      }
      exitAfterChild("backend-tunnel", code, signal);
    });
    return backendTunnel;
  }
  startBackendTunnel();

  const localBackendUrl = `http://127.0.0.1:${localBackendPort}`;
  await waitForHttpOk(`${localBackendUrl}/healthz`);

  const platform = startProcess(
    "corepack",
    ["pnpm@9.12.0", "--filter", "@puddle/platform", "dev"],
    {
      label: "platform",
      env: envList({
        PUDDLE_BACKEND_BASE_URL: localBackendUrl,
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
