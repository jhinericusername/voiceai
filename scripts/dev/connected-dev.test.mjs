import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import * as connectedDev from "./connected-dev.mjs";
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
  waitForTcpOpen,
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

test("parseTcpPort returns the default when the value is unset", () => {
  assert.equal(connectedDev.parseTcpPort(undefined, "PORT", 8080), 8080);
  assert.equal(connectedDev.parseTcpPort("", "PORT", 8080), 8080);
});

test("parseTcpPort returns a valid explicit port", () => {
  assert.equal(connectedDev.parseTcpPort("18080", "PUDDLE_CONNECTED_BACKEND_PORT", 8080), 18080);
});

test("parseTcpPort rejects non-numeric values", () => {
  assert.throws(
    () => connectedDev.parseTcpPort("abc", "PUDDLE_CONNECTED_DB_PORT", 15432),
    /PUDDLE_CONNECTED_DB_PORT must be a TCP port/,
  );
});

test("parseTcpPort rejects zero", () => {
  assert.throws(
    () => connectedDev.parseTcpPort("0", "PUDDLE_CONNECTED_DB_PORT", 15432),
    /PUDDLE_CONNECTED_DB_PORT must be a TCP port/,
  );
});

test("parseTcpPort rejects ports greater than 65535", () => {
  assert.throws(
    () => connectedDev.parseTcpPort("65536", "PUDDLE_CONNECTED_DB_PORT", 15432),
    /PUDDLE_CONNECTED_DB_PORT must be a TCP port/,
  );
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

test("waitForTcpOpen succeeds once a local TCP server accepts connections", async () => {
  const server = net.createServer((socket) => socket.end());
  await listen(server, 0, "127.0.0.1");
  try {
    const { port } = server.address();
    await waitForTcpOpen(port, "127.0.0.1", { timeoutMs: 250, intervalMs: 10 });
  } finally {
    await close(server);
  }
});

test("waitForTcpOpen rejects when the port never opens", async () => {
  const server = net.createServer();
  await listen(server, 0, "127.0.0.1");
  const { port } = server.address();
  await close(server);

  await assert.rejects(
    waitForTcpOpen(port, "127.0.0.1", { timeoutMs: 25, intervalMs: 5 }),
    /Timed out waiting for TCP 127\.0\.0\.1:/,
  );
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

test("assertPortAvailable preserves non-EADDRINUSE listen errors", async () => {
  const listenError = Object.assign(new Error("listen EPERM: operation not permitted 127.0.0.1"), {
    code: "EPERM",
  });

  await assert.rejects(
    assertPortAvailable(15432, "127.0.0.1", {
      createServerFn: () => fakeListenErrorServer(listenError),
    }),
    /Failed to check local port 15432: listen EPERM: operation not permitted 127\.0\.0\.1/,
  );
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

test("root package exposes connected dev commands", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );

  assert.equal(packageJson.scripts["dev:connected"], "node scripts/dev/dev-connected.mjs");
  assert.equal(
    packageJson.scripts["dev:backend:connected"],
    "node scripts/dev/dev-backend-connected.mjs",
  );
  assert.equal(
    packageJson.scripts["grading:evaluate:connected"],
    "node scripts/dev/grading-evaluate-connected.mjs",
  );
  assert.equal(
    packageJson.scripts["historical-fireflies:metadata-backfill:connected"],
    "node scripts/dev/historical-fireflies-metadata-backfill-connected.mjs",
  );
  assert.equal(
    packageJson.scripts["test:connected-dev"],
    "node --test scripts/dev/connected-dev.test.mjs",
  );
});

test("backend connected runner clears inherited DATABASE_URL", async () => {
  const source = await readFile(new URL("./dev-backend-connected.mjs", import.meta.url), "utf8");

  assert.match(source, /DATABASE_URL:\s*""/);
});

test("backend connected runner binds local backend to loopback", async () => {
  const source = await readFile(new URL("./dev-backend-connected.mjs", import.meta.url), "utf8");

  assert.match(source, /^\s*HOST:\s*"127\.0\.0\.1",$/m);
});

test("platform connected runner restarts backend tunnel after clean SSM timeout", async () => {
  const source = await readFile(new URL("./dev-connected.mjs", import.meta.url), "utf8");

  assert.match(source, /function startBackendTunnel/);
  assert.match(source, /code === 0 && !signal/);
  assert.match(source, /restarting/);
  assert.match(source, /startBackendTunnel\(\)/);
});

test("grading evaluation connected runner clears inherited database URLs", async () => {
  const source = await readFile(
    new URL("./grading-evaluate-connected.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /DATABASE_URL:\s*""/);
  assert.match(source, /WEAVE_DATABASE_URL:\s*""/);
});

test("grading evaluation connected runner wires both puddle and weave databases", async () => {
  const source = await readFile(
    new URL("./grading-evaluate-connected.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /^\s*DATABASE_HOST:\s*"127\.0\.0\.1",$/m);
  assert.match(source, /^\s*WEAVE_DATABASE_HOST:\s*"127\.0\.0\.1",$/m);
  assert.match(source, /^\s*WEAVE_DATABASE_NAME:\s*"weave",$/m);
  assert.match(source, /waitForTcpOpen\(dbLocalPort/);
});

test("historical Fireflies metadata backfill connected runner is metadata-only", async () => {
  const source = await readFile(
    new URL("./historical-fireflies-metadata-backfill-connected.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /"--metadata-only"/);
  assert.match(source, /DATABASE_URL:\s*""/);
  assert.match(source, /WeaveHistoricalRecordingsBucketName/);
  assert.match(source, /ArtifactsBucketName/);
});

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

function fakeListenErrorServer(error) {
  const server = new EventEmitter();
  server.close = () => {};
  server.listen = () => {
    queueMicrotask(() => server.emit("error", error));
  };
  return server;
}
