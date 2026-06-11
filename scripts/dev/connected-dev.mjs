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
