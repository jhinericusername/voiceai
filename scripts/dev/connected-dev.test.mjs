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
