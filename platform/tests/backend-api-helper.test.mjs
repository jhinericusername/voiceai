import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeFiles = [
  "app/api/interviews/route.ts",
  "app/api/interviews/[token]/join/route.ts",
  "app/api/livekit/webhook/route.ts",
];

const backendApiSource = await readFile(new URL("../lib/backend-api.ts", import.meta.url), "utf8");
const dashboardDataSource = await readFile(new URL("../app/dashboard/backend-data.ts", import.meta.url), "utf8");
const ashbyServerSource = await readFile(new URL("../lib/ashby/server.ts", import.meta.url), "utf8");

test("backend proxy routes share backend-api helpers", async () => {
  for (const routeFile of routeFiles) {
    const source = await readFile(new URL(`../${routeFile}`, import.meta.url), "utf8");
    assert.match(source, /@\/lib\/backend-api/);
    assert.equal(source.includes("function backendBaseUrl"), false, routeFile);
  }
});

test("backend API helper applies an explicit fetch timeout", () => {
  assert.match(backendApiSource, /DEFAULT_BACKEND_FETCH_TIMEOUT_MS/);
  assert.match(backendApiSource, /backendFetch/);
  assert.match(backendApiSource, /AbortSignal\.timeout/);
  assert.match(backendApiSource, /PUDDLE_BACKEND_FETCH_TIMEOUT_MS/);
});

test("dashboard backend reads use timeout-bounded backend fetches", () => {
  assert.match(dashboardDataSource, /backendFetch/);
  assert.doesNotMatch(dashboardDataSource, /await fetch\(`/);
});

test("Ashby server reads use timeout-bounded backend fetches", () => {
  assert.match(ashbyServerSource, /backendFetch/);
  assert.doesNotMatch(ashbyServerSource, /await fetch\(`/);
});
