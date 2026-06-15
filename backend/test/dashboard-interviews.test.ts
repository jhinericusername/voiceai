import { describe, expect, it } from "vitest";
import { signedCompositeVideoUrl } from "../src/dashboard/routes.js";
import {
  interviewDetailStatement,
  interviewListStatement,
} from "../src/dashboard/interviews.js";

describe("dashboard interview read model", () => {
  it("queries recent interview packets", () => {
    const stmt = interviewListStatement({ limit: 25, orgId: "org1" });

    expect(stmt.sql).toContain("FROM sessions s");
    expect(stmt.sql).toContain("LEFT JOIN recordings r");
    expect(stmt.sql).toContain("LEFT JOIN assessments a");
    expect(stmt.sql).toContain("s.external_source");
    expect(stmt.sql).toContain("s.external_id");
    expect(stmt.sql).toContain("s.source_metadata");
    expect(stmt.sql).toContain("WHERE s.org_id = $2");
    expect(stmt.sql).toContain("LIMIT $1");
    expect(stmt.params).toEqual([25, "org1"]);
  });

  it("queries one interview packet detail", () => {
    const stmt = interviewDetailStatement("sess1", "org1");

    expect(stmt.sql).toContain("WHERE s.session_id = $1 AND s.org_id = $2");
    expect(stmt.sql).toContain("s.external_source");
    expect(stmt.sql).toContain("s.external_id");
    expect(stmt.sql).toContain("s.source_metadata");
    expect(stmt.sql).toContain("json_agg");
    expect(stmt.sql).toContain("LEFT JOIN LATERAL");
    expect(stmt.sql).toContain("ORDER BY ordered.turn_index");
    expect(stmt.sql).toContain("ORDER BY ordered.kind");
    expect(stmt.params).toEqual(["sess1", "org1"]);
  });

  it("signs only available composite recordings", async () => {
    const client = { send: async () => ({}) };
    const signer = async () => "https://signed.example/composite.mp4";

    await expect(
      signedCompositeVideoUrl(
        [
          {
            kind: "composite_video",
            status: "available",
            storagePath: "/org1/interviews/sess1/media/composite.mp4",
          },
        ],
        { bucket: "puddle-artifacts", client, signer },
      ),
    ).resolves.toBe("https://signed.example/composite.mp4");
  });

  it("does not require a bucket when no composite recording is available", async () => {
    const client = { send: async () => ({}) };
    const signer = async () => "unused";

    await expect(
      signedCompositeVideoUrl(
        [
          {
            kind: "composite_video",
            status: "expected",
            storagePath: "/org1/interviews/sess1/media/composite.mp4",
          },
        ],
        {
          bucket: () => {
            throw new Error("bucket should not be read");
          },
          client,
          signer,
        },
      ),
    ).resolves.toBeNull();
  });
});
