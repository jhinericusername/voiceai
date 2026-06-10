import { describe, it, expect } from "vitest";
import {
  internalRouteRequiresAuth,
} from "../src/integration/internal-auth.js";
import {
  validateCreateSessionRequest,
  toAssessmentResponse,
  INTEGRATION_API_VERSION,
} from "../src/integration/contract.js";

describe("integration contract", () => {
  it("pins an explicit API version", () => {
    expect(INTEGRATION_API_VERSION).toBe("2026-05-20");
  });

  it("validates a create-session request from the platform", () => {
    const result = validateCreateSessionRequest({
      orgId: "org1",
      candidateEmail: "c@example.com",
      scriptVersion: "pilot-v1",
      scheduledAt: "2026-05-21T15:00:00Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a create-session request missing required fields", () => {
    const result = validateCreateSessionRequest({
      orgId: "org1",
      candidateEmail: "",
      scriptVersion: "pilot-v1",
      scheduledAt: "2026-05-21T15:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("candidateEmail");
  });

  it("rejects a create-session request with an unusably short invite TTL", () => {
    const result = validateCreateSessionRequest({
      orgId: "org1",
      candidateEmail: "c@example.com",
      scriptVersion: "pilot-v1",
      scheduledAt: "2026-05-21T15:00:00Z",
      inviteTtlSeconds: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("inviteTtlSeconds");
  });

  it("maps an internal assessment to the platform response shape", () => {
    const response = toAssessmentResponse({
      sessionId: "sess1",
      scriptVersion: "pilot-v1",
      categoryScores: [
        { category: "problem_solving", score: 4, confidence: 0.9, lowConfidence: false },
      ],
      meetsBareMinimum: true,
      integrityFlags: ["reading_off_screen"],
      reviewerEmail: "reviewer@puddle.com",
      signedOffAt: "2026-05-21T16:00:00Z",
    });
    expect(response.apiVersion).toBe("2026-05-20");
    expect(response.sessionId).toBe("sess1");
    expect(response.recommendation).toBe("meets_bar");
    expect(response.humanSignedOff).toBe(true);
    expect(response.categoryScores[0].category).toBe("problem_solving");
  });

  it("marks an unsigned assessment as not human-signed-off", () => {
    const response = toAssessmentResponse({
      sessionId: "sess1",
      scriptVersion: "pilot-v1",
      categoryScores: [],
      meetsBareMinimum: false,
      integrityFlags: [],
      reviewerEmail: null,
      signedOffAt: null,
    });
    expect(response.humanSignedOff).toBe(false);
    expect(response.recommendation).toBe("below_bar");
  });
});

describe("internal auth route matching", () => {
  it("requires auth for all internal routes regardless of method", () => {
    expect(internalRouteRequiresAuth("GET", "/internal/interviews")).toBe(true);
    expect(internalRouteRequiresAuth("POST", "/internal/sessions/sess1/finalize")).toBe(true);
    expect(internalRouteRequiresAuth("GET", "/healthz")).toBe(false);
  });
});
