import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeClientSource = await readFile(new URL("../app/HomeClient.tsx", import.meta.url), "utf8");
const sampleReportSource = await readFile(new URL("../app/sample-report/SampleReportClient.tsx", import.meta.url), "utf8");
const publicNavSource = await readFile(new URL("../app/PublicNav.tsx", import.meta.url), "utf8");
const landingSource = `${homeClientSource}\n${sampleReportSource}\n${publicNavSource}`;

test("landing page does not use 2xl breakpoint scale-ups", () => {
  assert.equal(landingSource.includes("2xl:"), false);
});

test("landing hero keeps the largest headline below 7xl", () => {
  const heroHeadingClass = homeClientSource.match(/<h1 className="([^"]+)"/)?.[1] ?? "";

  assert.ok(heroHeadingClass.includes("xl:text-6xl"));
  assert.equal(heroHeadingClass.includes("text-7xl"), false);
  assert.equal(heroHeadingClass.includes("lg:text-7xl"), false);
});

test("landing sections do not use oversized desktop section classes", () => {
  assert.equal(landingSource.includes("md:text-5xl"), false);
  assert.equal(landingSource.includes("py-20"), false);
  assert.equal(landingSource.includes("md:py-20"), false);
  assert.equal(landingSource.includes("min-h-28"), false);
  assert.equal(landingSource.includes("max-w-7xl"), false);
});

test("public navbar and hero top offset stay compact", () => {
  assert.equal(publicNavSource.includes("px-5 py-3 sm:px-6 lg:px-8"), false);
  assert.equal(publicNavSource.includes("h-9 w-9"), false);
  assert.equal(publicNavSource.includes("text-lg font-semibold text-slate-950"), false);
  assert.equal(homeClientSource.includes("pt-28"), false);
  assert.equal(homeClientSource.includes("lg:pt-32"), false);
});

test("workflow scroll animation uses compact stage sizing", () => {
  assert.equal(homeClientSource.includes("lg:grid-cols-[0.76fr_1.24fr]"), false);
  assert.equal(homeClientSource.includes("gap-10"), false);
  assert.equal(homeClientSource.includes("min-h-[286px]"), false);
  assert.equal(homeClientSource.includes("min-h-[440px]"), false);
  assert.equal(homeClientSource.includes("lg:p-6"), false);
  assert.equal(homeClientSource.includes("mt-2 text-3xl font-semibold leading-none text-white"), false);
});
