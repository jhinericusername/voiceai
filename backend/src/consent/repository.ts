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

export type SqlParam = string | number | boolean | null | readonly string[] | readonly number[] | readonly boolean[];

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly SqlParam[];
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

export function consentUpsertStatement(input: ConsentInput): SqlStatement {
  return {
    sql:
      "INSERT INTO consent_records " +
      "(session_id, candidate_email, ai_disclosure_acknowledged, " +
      "recording_consented, consented_at) VALUES ($1, $2, $3, $4, $5) " +
      "ON CONFLICT (session_id) DO UPDATE SET " +
      "candidate_email = EXCLUDED.candidate_email, " +
      "ai_disclosure_acknowledged = EXCLUDED.ai_disclosure_acknowledged, " +
      "recording_consented = EXCLUDED.recording_consented, " +
      "consented_at = EXCLUDED.consented_at",
    params: [
      input.sessionId,
      input.candidateEmail,
      input.aiDisclosureAcknowledged,
      input.recordingConsented,
      input.consentedAt,
    ],
  };
}
