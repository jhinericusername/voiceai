import { describe, it, expect, vi } from "vitest";
import {
  buildSessionRecord,
  buildWorkerDispatchMetadata,
  createSessionInsert,
  sessionRoomUpdateStatement,
  sessionStatusUpdateStatement,
} from "../src/scheduler/sessions.js";

describe("buildSessionRecord", () => {
  it("creates a scheduled session with the given identity", () => {
    const record = buildSessionRecord({
      sessionId: "sess1",
      orgId: "org1",
      candidateEmail: "c@example.com",
      scriptVersion: "pilot-v1",
      scheduledAt: "2026-05-21T15:00:00Z",
    });
    expect(record.status).toBe("scheduled");
    expect(record.sessionId).toBe("sess1");
    expect(record.scriptVersion).toBe("pilot-v1");
  });
});

describe("createSessionInsert", () => {
  it("builds a parameterized insert for the sessions table", () => {
    const stmt = createSessionInsert(
      buildSessionRecord({
        sessionId: "sess1",
        orgId: "org1",
        candidateEmail: "c@example.com",
        scriptVersion: "pilot-v1",
        scheduledAt: "2026-05-21T15:00:00Z",
      }),
    );
    expect(stmt.sql).toContain("INSERT INTO sessions");
    expect(stmt.params).toEqual([
      "sess1",
      "org1",
      "c@example.com",
      "pilot-v1",
      "scheduled",
      "2026-05-21T15:00:00Z",
    ]);
  });
});

describe("buildWorkerDispatchMetadata", () => {
  it("serializes the metadata the agent worker entrypoint parses", () => {
    const meta = buildWorkerDispatchMetadata({
      sessionId: "sess1",
      orgId: "org1",
      candidateEmail: "c@example.com",
      scriptVersion: "pilot-v1",
      scheduledAt: "2026-05-21T15:00:00Z",
      status: "scheduled",
    });
    const parsed = JSON.parse(meta);
    expect(parsed.session_id).toBe("sess1");
    expect(parsed.org_id).toBe("org1");
    expect(parsed.script_version).toBe("pilot-v1");
    expect(parsed.candidate_email).toBe("c@example.com");
  });
});

describe("session update statements", () => {
  it("persists the LiveKit room name after provisioning", () => {
    const stmt = sessionRoomUpdateStatement("sess1", "interview-sess1");
    expect(stmt.sql).toContain("room_name = $2");
    expect(stmt.params).toEqual(["sess1", "interview-sess1"]);
  });

  it("updates dashboard-facing session status and timestamps", () => {
    const stmt = sessionStatusUpdateStatement("sess1", "in_progress", {
      startedAt: "2026-05-29T10:00:00Z",
    });
    expect(stmt.sql).toContain("status = $2");
    expect(stmt.params).toEqual(["sess1", "in_progress", "2026-05-29T10:00:00Z", null]);
  });

  it("can update base session status without dashboard timeline columns", () => {
    const stmt = sessionStatusUpdateStatement("sess1", "in_progress", {
      startedAt: "2026-05-29T10:00:00Z",
      includeTimelineColumns: false,
    });
    expect(stmt.sql).not.toContain("started_at");
    expect(stmt.sql).toContain("status = $2");
    expect(stmt.params).toEqual(["sess1", "in_progress"]);
  });
});
