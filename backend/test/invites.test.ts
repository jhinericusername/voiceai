import { describe, expect, it } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";
import {
  buildCandidateInviteRecord,
  createCandidateInviteInsert,
  findCandidateInviteByTokenStatement,
  invitePath,
  isInviteUsable,
  type CandidateInviteRow,
} from "../src/invites/repository.js";
import { consentInputFromCandidateJoin } from "../src/invites/routes.js";
import { generateInviteToken, hashInviteToken } from "../src/invites/tokens.js";
import { buildCandidateJoinToken } from "../src/livekit/token.js";

describe("candidate invite tokens", () => {
  it("generates opaque URL-safe tokens and hashes them before persistence", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^inv_[A-Za-z0-9_-]+$/);
    expect(hashInviteToken(token)).not.toBe(token);
    expect(invitePath(token)).toBe(`/interview/${encodeURIComponent(token)}`);
  });
});

describe("candidate invite repository", () => {
  it("builds a parameterized insert with a hashed invite token", () => {
    const record = buildCandidateInviteRecord({
      sessionId: "sess1",
      candidateEmail: "candidate@example.com",
      token: "inv_test",
      now: new Date("2026-05-25T12:00:00Z"),
      ttlSeconds: 600,
    });
    const stmt = createCandidateInviteInsert(record);

    expect(stmt.sql).toContain("INSERT INTO candidate_invites");
    expect(stmt.params).toEqual([
      record.inviteId,
      "sess1",
      "candidate@example.com",
      hashInviteToken("inv_test"),
      "2026-05-25T12:00:00.000Z",
      "2026-05-25T12:10:00.000Z",
    ]);
  });

  it("looks up invite rows by token hash", () => {
    const stmt = findCandidateInviteByTokenStatement("inv_test");
    expect(stmt.sql).toContain("WHERE token_hash = $1");
    expect(stmt.params).toEqual([hashInviteToken("inv_test")]);
  });

  it("rejects revoked and expired invites", () => {
    const active = {
      invite_id: "invite1",
      session_id: "sess1",
      candidate_email: "candidate@example.com",
      status: "active",
      not_before: "2026-05-25T12:00:00Z",
      expires_at: "2026-05-25T13:00:00Z",
      revoked_at: null,
      join_count: 0,
    };

    expect(isInviteUsable(active, new Date("2026-05-25T12:30:00Z"))).toEqual({ ok: true });
    expect(
      isInviteUsable(
        { ...active, revoked_at: "2026-05-25T12:20:00Z" },
        new Date("2026-05-25T12:30:00Z"),
      ),
    ).toEqual({ ok: false, reason: "revoked" });
    expect(isInviteUsable(active, new Date("2026-05-25T13:00:01Z"))).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("candidate join consent", () => {
  const invite: CandidateInviteRow = {
    invite_id: "invite1",
    session_id: "sess1",
    candidate_email: "candidate@example.com",
    status: "active",
    not_before: "2026-05-25T12:00:00Z",
    expires_at: "2026-05-25T13:00:00Z",
    revoked_at: null,
    join_count: 0,
  };

  it("builds consent persistence input from the candidate join body", () => {
    const result = consentInputFromCandidateJoin(
      invite,
      {
        consent: {
          aiDisclosureAcknowledged: true,
          recordingConsented: true,
          dataUseAcknowledged: true,
          consentedAt: "2026-05-29T10:00:00Z",
        },
      },
      new Date("2026-05-29T10:00:01Z"),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input).toEqual({
        sessionId: "sess1",
        candidateEmail: "candidate@example.com",
        aiDisclosureAcknowledged: true,
        recordingConsented: true,
        consentedAt: "2026-05-29T10:00:00Z",
      });
    }
  });

  it("rejects joins that have not acknowledged recording and data use", () => {
    expect(consentInputFromCandidateJoin(invite, undefined).ok).toBe(false);
    const result = consentInputFromCandidateJoin(invite, {
      consent: {
        aiDisclosureAcknowledged: true,
        recordingConsented: false,
        dataUseAcknowledged: true,
      },
    });
    expect(result).toEqual({
      ok: false,
      reason: "recording consent is required before recording",
    });
  });
});

describe("candidate LiveKit tokens", () => {
  it("scopes the join token to the candidate room", async () => {
    const token = await buildCandidateJoinToken(
      { host: "wss://livekit.example", apiKey: "key", apiSecret: "secret" },
      {
        sessionId: "sess1",
        room: "interview-sess1",
        inviteId: "invite1",
        candidateEmail: "candidate@example.com",
        ttlSeconds: 60,
      },
    );
    const verifier = new TokenVerifier("key", "secret");
    const claims = await verifier.verify(token);

    expect(claims.sub).toBe("candidate-invite1");
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.room).toBe("interview-sess1");
    expect(claims.name).toBe("candidate@example.com");
  });
});
