import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const appDir = new URL("../app/", import.meta.url);
const publicShellSource = await readFile(new URL("../app/PublicPageShell.tsx", import.meta.url), "utf8");
const legalShellSource = await readFile(new URL("../app/LegalPageShell.tsx", import.meta.url), "utf8");
const resourcesIndexSource = await readFile(new URL("../app/resources/page.tsx", import.meta.url), "utf8");
const resourceArticleSource = await readFile(new URL("../app/resources/[slug]/page.tsx", import.meta.url), "utf8");
const sampleReportSource = await readFile(new URL("../app/sample-report/SampleReportClient.tsx", import.meta.url), "utf8");
const interviewPageSource = await readFile(new URL("../app/interview/[token]/page.tsx", import.meta.url), "utf8");
const interviewJoinSource = await readFile(new URL("../app/interview/[token]/InterviewJoinClient.tsx", import.meta.url), "utf8");
const notAuthorizedSource = await readFile(new URL("../app/not-authorized/page.tsx", import.meta.url), "utf8");

async function readTsxSources(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const sources = [];

  for (const entry of entries) {
    const entryPath = path.join(dir.pathname, entry.name);

    if (entry.isDirectory()) {
      sources.push(...await readTsxSources(new URL(`${entry.name}/`, dir)));
    } else if (entry.name.endsWith(".tsx")) {
      sources.push({
        path: entryPath,
        source: await readFile(entryPath, "utf8"),
      });
    }
  }

  return sources;
}

const appSources = await readTsxSources(appDir);
const combinedAppSource = appSources.map((file) => file.source).join("\n");

test("public and platform pages do not use oversized desktop width scale-ups", () => {
  assert.equal(combinedAppSource.includes("max-w-7xl"), false);
  assert.equal(combinedAppSource.includes("max-w-[1440px]"), false);
  assert.equal(combinedAppSource.includes("max-w-[1600px]"), false);
  assert.equal(combinedAppSource.includes("2xl:"), false);
});

test("shared public shell keeps hero typography compact", () => {
  assert.equal(publicShellSource.includes("lg:text-6xl"), false);
  assert.equal(publicShellSource.includes("md:text-5xl"), false);
  assert.equal(publicShellSource.includes("xl:text-5xl"), false);
  assert.equal(publicShellSource.includes("pt-32"), false);
  assert.equal(publicShellSource.includes("lg:pt-36"), false);
  assert.equal(publicShellSource.includes("gap-10"), false);
  assert.ok(publicShellSource.includes("max-w-3xl text-3xl"));
  assert.ok(publicShellSource.includes("sm:text-4xl"));
});

test("resource pages keep desktop layouts compact", () => {
  assert.equal(resourcesIndexSource.includes("max-w-7xl"), false);
  assert.equal(resourceArticleSource.includes("max-w-7xl"), false);
  assert.equal(resourceArticleSource.includes("gap-10"), false);
  assert.equal(resourcesIndexSource.includes("pt-32"), false);
  assert.equal(resourceArticleSource.includes("pt-32"), false);
  assert.equal(resourcesIndexSource.includes("lg:pt-36"), false);
  assert.equal(resourceArticleSource.includes("lg:pt-36"), false);
  assert.equal(resourcesIndexSource.includes("sm:text-5xl"), false);
  assert.equal(resourceArticleSource.includes("sm:text-5xl"), false);
  assert.ok(resourcesIndexSource.includes("text-3xl"));
  assert.ok(resourceArticleSource.includes("text-3xl"));
  assert.ok(resourcesIndexSource.includes("sm:text-4xl"));
  assert.ok(resourceArticleSource.includes("sm:text-4xl"));
});

test("legal and sample report pages avoid landing-scale spacing", () => {
  assert.equal(legalShellSource.includes("pt-32"), false);
  assert.equal(legalShellSource.includes("lg:pt-36"), false);
  assert.equal(legalShellSource.includes("sm:text-5xl"), false);
  assert.ok(legalShellSource.includes("text-3xl"));
  assert.ok(legalShellSource.includes("sm:text-4xl"));

  assert.equal(sampleReportSource.includes("pb-20"), false);
  assert.equal(sampleReportSource.includes("pt-32"), false);
  assert.equal(sampleReportSource.includes("lg:pt-36"), false);
  assert.equal(sampleReportSource.includes("max-w-[92vw]"), false);
  assert.equal(sampleReportSource.includes("xl:max-w-[75vw]"), false);
  assert.ok(sampleReportSource.includes("pb-14 pt-24"));
});

test("interview join page keeps the work surface compact", () => {
  assert.equal(interviewPageSource.includes("max-w-[1600px]"), false);
  assert.equal(interviewJoinSource.includes("lg:min-h-[680px]"), false);
  assert.equal(interviewJoinSource.includes("lg:gap-8"), false);
  assert.equal(interviewJoinSource.includes("lg:p-8"), false);
  assert.ok(interviewPageSource.includes("max-w-[1180px]"));
  assert.ok(interviewJoinSource.includes("lg:min-h-[600px]"));
  assert.ok(interviewJoinSource.includes("lg:gap-5"));
  assert.ok(interviewJoinSource.includes("lg:p-5"));
});

test("standalone status pages avoid oversized headlines", () => {
  assert.equal(notAuthorizedSource.includes("md:text-5xl"), false);
});
