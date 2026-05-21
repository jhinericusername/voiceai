import { describe, it, expect } from "vitest";
import { ROOM_STEPS, nextStep, canEnterCall } from "../src/flow.js";

describe("room flow", () => {
  it("orders steps: landing -> consent -> preflight -> waiting -> incall -> done", () => {
    expect(ROOM_STEPS).toEqual([
      "landing",
      "consent",
      "preflight",
      "waiting",
      "incall",
      "completion",
    ]);
  });

  it("advances one step at a time", () => {
    expect(nextStep("landing")).toBe("consent");
    expect(nextStep("consent")).toBe("preflight");
    expect(nextStep("incall")).toBe("completion");
  });

  it("does not advance past completion", () => {
    expect(nextStep("completion")).toBe("completion");
  });

  it("blocks the call until consent and preflight are both done", () => {
    expect(canEnterCall({ consentGiven: false, preflightPassed: true })).toBe(false);
    expect(canEnterCall({ consentGiven: true, preflightPassed: false })).toBe(false);
    expect(canEnterCall({ consentGiven: true, preflightPassed: true })).toBe(true);
  });
});
