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
