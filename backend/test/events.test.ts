import { describe, expect, it } from "vitest";
import {
  auditLogInsertStatement,
  lastAuditHashStatement,
  opsEventInsertStatement,
} from "../src/events/repository.js";

describe("ops event persistence statements", () => {
  it("stores lifecycle metadata as ops events", () => {
    const stmt = opsEventInsertStatement({
      sessionId: "sess1",
      eventType: "candidate_first_join",
      payload: { room: "interview-sess1", late_seconds: 120 },
    });

    expect(stmt.sql).toContain("INSERT INTO events");
    expect(stmt.params[0]).toBe("sess1");
    expect(stmt.params[1]).toBe("ops");
    expect(JSON.parse(String(stmt.params[2]))).toEqual({
      event_type: "candidate_first_join",
      room: "interview-sess1",
      late_seconds: 120,
    });
  });

  it("builds audit log entries chained to the previous hash", () => {
    const lastHash = lastAuditHashStatement("sess1");
    expect(lastHash.sql).toContain("ORDER BY id DESC LIMIT 1");
    expect(lastHash.params).toEqual(["sess1"]);

    const stmt = auditLogInsertStatement(
      {
        sessionId: "sess1",
        eventType: "candidate_reconnect_within_grace",
        payload: { reconnect_count: 1 },
      },
      "previous-hash",
    );

    expect(stmt.sql).toContain("INSERT INTO audit_log");
    expect(stmt.params.slice(0, 4)).toEqual([
      "sess1",
      "candidate_reconnect_within_grace",
      JSON.stringify({ reconnect_count: 1 }),
      "previous-hash",
    ]);
    expect(String(stmt.params[4])).toMatch(/^[a-f0-9]{64}$/);
  });
});
