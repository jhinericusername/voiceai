export interface ConsentInput {
  readonly sessionId: string;
  readonly candidateEmail: string;
  readonly aiDisclosureAcknowledged: boolean;
  readonly recordingConsented: boolean;
  readonly consentedAt: string;
}

export type ConsentValidation = { ok: true } | { ok: false; reason: string };

export function validateConsent(input: ConsentInput): ConsentValidation {
  if (!input.aiDisclosureAcknowledged) {
    return { ok: false, reason: "AI disclosure must be acknowledged before recording" };
  }
  if (!input.recordingConsented) {
    return { ok: false, reason: "recording consent is required before recording" };
  }
  return { ok: true };
}

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly (string | boolean)[];
}

export function consentInsertStatement(input: ConsentInput): SqlStatement {
  return {
    sql:
      "INSERT INTO consent_records " +
      "(session_id, candidate_email, ai_disclosure_acknowledged, " +
      "recording_consented, consented_at) VALUES ($1, $2, $3, $4, $5)",
    params: [
      input.sessionId,
      input.candidateEmail,
      input.aiDisclosureAcknowledged,
      input.recordingConsented,
      input.consentedAt,
    ],
  };
}
