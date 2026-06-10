import { describe, expect, it } from "vitest";
import { isCandidateReady } from "../src/readiness.js";

describe("isCandidateReady", () => {
  it("is ready only when mic is published and audio can play", () => {
    expect(isCandidateReady(true, true)).toBe(true);
    expect(isCandidateReady(false, true)).toBe(false);
    expect(isCandidateReady(true, false)).toBe(false);
    expect(isCandidateReady(false, false)).toBe(false);
  });
});
