import { describe, expect, it } from "vitest";
import { signedArtifactMediaUrl, signedCompositeVideoUrl } from "../src/dashboard/routes.js";
import {
  interviewDetailStatement,
  interviewListStatement,
  roomRecordingListStatement,
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

  it("queries historical Fireflies and room recordings for the dashboard list", () => {
    const stmt = roomRecordingListStatement({ limit: 25, orgId: "org1" });

    expect(stmt.sql).toContain("FROM sessions s");
    expect(stmt.sql).toContain("JOIN recordings r");
    expect(stmt.sql).toContain("LEFT JOIN recording_artifacts composite");
    expect(stmt.sql).toContain("composite.kind = 'composite_video'");
    expect(stmt.sql).toContain("WHERE s.org_id = $2");
    expect(stmt.sql).toContain("LIMIT $1");
    expect(stmt.sql).not.toContain("s.external_source IS DISTINCT FROM 'fireflies'");
    expect(stmt.sql).not.toContain("r.egress_id NOT LIKE 'fireflies:%'");
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
    expect(stmt.sql).toContain("latest_recommendation.item AS recommendation_packet");
    expect(stmt.sql).toContain("FROM interview_recommendations rec");
    expect(stmt.sql).toContain("rec.organization_id = s.org_id");
    expect(stmt.sql).toContain("'rubricVersionId', rec.rubric_version_id");
    expect(stmt.sql).toContain("'confidence', rec.confidence");
    expect(stmt.sql).toContain("'categoryScores', rec.category_scores");
    expect(stmt.sql).toContain("'evidence', rec.evidence");
    expect(stmt.sql).toContain("'scorecardJson', rec.scorecard_json");
    expect(stmt.sql).toContain("'warnings', rec.warnings");
    expect(stmt.sql).toContain("'latestFeedback', latest_feedback.item");
    expect(stmt.sql).toContain("FROM reviewer_feedback feedback");
    expect(stmt.sql).toContain("feedback.recommendation_id = rec.recommendation_id");
    expect(stmt.sql).toContain("feedback.session_id = rec.session_id");
    expect(stmt.sql).toContain("feedback.organization_id = rec.organization_id");
    expect(stmt.sql).toContain("ORDER BY rec.updated_at DESC, rec.created_at DESC");
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

  it("signs available candidate audio recordings by artifact kind", async () => {
    const client = { send: async () => ({}) };
    const signer = async () => "https://signed.example/candidate_audio.mp3";

    await expect(
      signedArtifactMediaUrl(
        [
          {
            kind: "candidate_audio",
            status: "available",
            storagePath: "/org1/interviews/sess1/media/candidate_audio.mp3",
          },
        ],
        { bucket: "puddle-artifacts", client, signer, kind: "candidate_audio" },
      ),
    ).resolves.toBe("https://signed.example/candidate_audio.mp3");
  });
});
