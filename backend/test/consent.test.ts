import { describe, it, expect } from "vitest";
import {
  consentInsertStatement,
  consentUpsertStatement,
  validateConsent,
} from "../src/consent/repository.js";

describe("validateConsent", () => {
  it("accepts a fully acknowledged, consented record", () => {
    const result = validateConsent({
      sessionId: "sess1",
      candidateEmail: "c@example.com",
      aiDisclosureAcknowledged: true,
      recordingConsented: true,
      consentedAt: "2026-05-20T10:00:00Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when AI disclosure is not acknowledged", () => {
    const result = validateConsent({
      sessionId: "sess1",
      candidateEmail: "c@example.com",
      aiDisclosureAcknowledged: false,
      recordingConsented: true,
      consentedAt: "2026-05-20T10:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("AI disclosure");
  });

  it("rejects when recording is not consented", () => {
    const result = validateConsent({
      sessionId: "sess1",
      candidateEmail: "c@example.com",
      aiDisclosureAcknowledged: true,
      recordingConsented: false,
      consentedAt: "2026-05-20T10:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("recording");
  });
});

describe("consentInsertStatement", () => {
  it("builds a parameterized insert for consent_records", () => {
    const stmt = consentInsertStatement({
      sessionId: "sess1",
      candidateEmail: "c@example.com",
      aiDisclosureAcknowledged: true,
      recordingConsented: true,
      consentedAt: "2026-05-20T10:00:00Z",
    });
    expect(stmt.sql).toContain("INSERT INTO consent_records");
    expect(stmt.params).toEqual([
      "sess1",
      "c@example.com",
      true,
      true,
      "2026-05-20T10:00:00Z",
    ]);
  });
});

describe("consentUpsertStatement", () => {
  it("makes consent persistence idempotent by session", () => {
    const stmt = consentUpsertStatement({
      sessionId: "sess1",
      candidateEmail: "candidate@example.com",
      aiDisclosureAcknowledged: true,
      recordingConsented: true,
      consentedAt: "2026-05-20T10:00:00Z",
    });
    expect(stmt.sql).toContain("ON CONFLICT (session_id)");
    expect(stmt.params).toEqual([
      "sess1",
      "candidate@example.com",
      true,
      true,
      "2026-05-20T10:00:00Z",
    ]);
  });
});
