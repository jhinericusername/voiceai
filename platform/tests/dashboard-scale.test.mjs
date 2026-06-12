import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const dashboardDir = new URL("../app/dashboard/", import.meta.url);

async function readSources(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const sources = [];

  for (const entry of entries) {
    const entryPath = path.join(dir.pathname, entry.name);

    if (entry.isDirectory()) {
      sources.push(...await readSources(new URL(`${entry.name}/`, dir)));
    } else if (entry.name.endsWith(".tsx")) {
      sources.push({
        path: entryPath,
        source: await readFile(entryPath, "utf8"),
      });
    }
  }

  return sources;
}

const dashboardSources = await readSources(dashboardDir);
const dashboardSource = dashboardSources.map((file) => file.source).join("\n");
const overviewSource = await readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");

test("dashboard pages use the compact workspace width", () => {
  assert.equal(dashboardSource.includes("max-w-[1440px]"), false);
});

test("dashboard overview keeps review queue compact", () => {
  assert.match(overviewSource, /<NeedsReviewQueue[\s\S]*limit=\{3\}/);
  assert.equal(dashboardSource.includes("min-w-[980px]"), false);
});

test("dashboard sidebars do not use the wide workbench columns", () => {
  assert.equal(dashboardSource.includes("_380px"), false);
  assert.equal(dashboardSource.includes("_360px"), false);
});
