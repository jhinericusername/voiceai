import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import {
  assertPortAvailable,
  awsJson,
  backendHostFromBaseUrl,
  buildRemotePortForwardArgs,
  envList,
  outputValue,
  parseSecretString,
  requireNonProdEnvironment,
  startAwsTunnel,
  startProcess,
  terminateChild,
  waitForHttpOk,
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

test("awsJson reports a spawn error", () => {
  assert.throws(
    () =>
      awsJson(["sts", "get-caller-identity"], { region: "us-west-1" }, {
        spawnSyncFn: () => ({
          error: Object.assign(new Error("spawn aws ENOENT"), { code: "ENOENT" }),
        }),
      }),
    /Failed to start AWS CLI: spawn aws ENOENT/,
  );
});

test("waitForHttpOk succeeds against a local HTTP server", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(204);
    response.end();
  });
  await listen(server, 0, "127.0.0.1");
  try {
    const { port } = server.address();
    await waitForHttpOk(`http://127.0.0.1:${port}`, { timeoutMs: 250, intervalMs: 10 });
  } finally {
    await close(server);
  }
});

test("waitForHttpOk rejects for a non-2xx response", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(503);
    response.end();
  });
  await listen(server, 0, "127.0.0.1");
  try {
    const { port } = server.address();
    await assert.rejects(
      waitForHttpOk(`http://127.0.0.1:${port}`, { timeoutMs: 25, intervalMs: 5 }),
      /HTTP 503/,
    );
  } finally {
    await close(server);
  }
});

test("assertPortAvailable rejects when a local server already occupies the port", async () => {
  const server = net.createServer();
  await listen(server, 0, "127.0.0.1");
  try {
    const { port } = server.address();
    await assert.rejects(assertPortAvailable(port), /already in use/);
  } finally {
    await close(server);
  }
});

test("terminateChild kills a process group when the child has a pid", () => {
  const killed = [];
  const child = {
    killed: false,
    pid: 12345,
    kill: () => {
      throw new Error("direct child kill should not be used");
    },
  };

  assert.doesNotThrow(() =>
    terminateChild(child, {
      killProcessGroup: (pid, signal) => killed.push([pid, signal]),
    }),
  );
  assert.deepEqual(killed, [[-12345, "SIGTERM"]]);
});

test("terminateChild falls back to child.kill and guards kill errors", () => {
  const child = {
    killed: false,
    kill: () => {
      throw new Error("already gone");
    },
  };

  assert.doesNotThrow(() => terminateChild(child));
});

test("startAwsTunnel spawns detached and logs start errors", () => {
  const errors = [];
  const startErrors = [];
  const calls = [];
  const child = fakeChild();
  const spawnError = new Error("spawn aws ENOENT");

  const result = startAwsTunnel({
    args: ["ssm", "start-session"],
    options: { region: "us-west-1" },
    label: "tunnel",
    spawnFn: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    },
    logger: { error: (message) => errors.push(message), log: () => {} },
    onError: (error) => startErrors.push(error),
  });

  child.emit("error", spawnError);

  assert.equal(result, child);
  assert.equal(calls[0].command, "aws");
  assert.equal(calls[0].options.detached, true);
  assert.deepEqual(errors, ["[tunnel] failed to start: spawn aws ENOENT"]);
  assert.deepEqual(startErrors, [spawnError]);
});

test("startProcess spawns detached and logs start errors", () => {
  const errors = [];
  const startErrors = [];
  const calls = [];
  const child = fakeChild();
  const spawnError = new Error("spawn corepack ENOENT");

  const result = startProcess("corepack", ["pnpm", "dev"], {
    cwd: "/tmp",
    env: { A: "one" },
    label: "platform",
    spawnFn: (command, args, options) => {
      calls.push({ command, args, options });
      return child;
    },
    logger: { error: (message) => errors.push(message), log: () => {} },
    onError: (error) => startErrors.push(error),
  });

  child.emit("error", spawnError);

  assert.equal(result, child);
  assert.equal(calls[0].command, "corepack");
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.env.A, "one");
  assert.deepEqual(errors, ["[platform] failed to start: spawn corepack ENOENT"]);
  assert.deepEqual(startErrors, [spawnError]);
});

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.pid = 12345;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}
