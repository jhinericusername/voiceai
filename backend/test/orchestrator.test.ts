import { describe, it, expect } from "vitest";
import { nextSessionStatus, isTerminal } from "../src/orchestrator/lifecycle.js";
import { dueForPrewarm } from "../src/orchestrator/prewarm.js";

describe("session lifecycle", () => {
  it("advances scheduled -> in_progress -> recording_finalizing -> review_ready", () => {
    expect(nextSessionStatus("scheduled")).toBe("in_progress");
    expect(nextSessionStatus("in_progress")).toBe("recording_finalizing");
    expect(nextSessionStatus("recording_finalizing")).toBe("review_ready");
  });

  it("treats review_ready and incomplete as terminal", () => {
    expect(isTerminal("review_ready")).toBe(true);
    expect(isTerminal("incomplete")).toBe(true);
    expect(isTerminal("in_progress")).toBe(false);
  });
});

describe("worker pre-warm", () => {
  it("flags a session due for pre-warm within the lead window", () => {
    const now = Date.parse("2026-05-21T14:55:00Z");
    // 5 minutes before start, lead window 10 minutes -> due.
    expect(
      dueForPrewarm("2026-05-21T15:00:00Z", now, 10 * 60 * 1000),
    ).toBe(true);
  });

  it("does not flag a session outside the lead window", () => {
    const now = Date.parse("2026-05-21T14:30:00Z");
    // 30 minutes before start, lead window 10 minutes -> not due.
    expect(
      dueForPrewarm("2026-05-21T15:00:00Z", now, 10 * 60 * 1000),
    ).toBe(false);
  });

  it("does not flag a session whose start has already passed", () => {
    const now = Date.parse("2026-05-21T15:30:00Z");
    expect(
      dueForPrewarm("2026-05-21T15:00:00Z", now, 10 * 60 * 1000),
    ).toBe(false);
  });
});
