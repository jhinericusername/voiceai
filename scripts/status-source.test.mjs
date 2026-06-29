import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const statusSource = await readFile(new URL("./status.sh", import.meta.url), "utf8");

test("status script reports active runtime task settings without secret values", () => {
  assert.match(statusSource, /section "Runtime task settings"/);
  assert.match(statusSource, /aws ecs describe-task-definition/);
  assert.match(statusSource, /PUDDLE_RECORDINGS_ENABLED/);
  assert.match(statusSource, /PUDDLE_ARTIFACTS_BUCKET/);
  assert.match(statusSource, /PUDDLE_EGRESS_S3_ACCESS_KEY_ID/);
  assert.match(statusSource, /PUDDLE_EGRESS_S3_SECRET_ACCESS_KEY/);
  assert.match(statusSource, /valueFrom/);
});
