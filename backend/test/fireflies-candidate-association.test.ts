import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCLUDED_EXTERNAL_EMAILS,
  extractUnmatchedExternalAttendees,
  generateCandidatePoolSql,
  rankCandidateApplications,
  type CandidateApplicationContext,
} from "../src/weave/fireflies/associateCandidates.js";

describe("Fireflies unmatched candidate association", () => {
  it("extracts unmatched external attendee emails with explicit exclusions", () => {
    const rows = [
      {
        match_status: "unmatched",
        fireflies_transcript_id: "tx_1",
        meeting_date: "2026-05-22",
        title: "Weave Engineering Intro chat - Patrick / Prakul",
        attendee_emails:
          "prakul@workweave.ai | patrick.s.bacon@relational.ai | app@mintybridge.com | fire+cal.com@incendiary.media",
      },
      {
        match_status: "matched",
        fireflies_transcript_id: "tx_2",
        meeting_date: "2026-05-23",
        title: "Already matched",
        attendee_emails: "someone@example.com",
      },
    ];

    const recordings = extractUnmatchedExternalAttendees(rows);

    expect(DEFAULT_EXCLUDED_EXTERNAL_EMAILS).toContain("app@mintybridge.com");
    expect(DEFAULT_EXCLUDED_EXTERNAL_EMAILS).toContain("fire+cal.com@incendiary.media");
    expect(recordings).toEqual([
      {
        firefliesTranscriptId: "tx_1",
        meetingDate: "2026-05-22",
        title: "Weave Engineering Intro chat - Patrick / Prakul",
        externalEmails: ["patrick.s.bacon@relational.ai"],
      },
    ]);
  });

  it("generates candidate-pool SQL that excludes already matched candidates and applications", () => {
    const sql = generateCandidatePoolSql({ afterDate: "2026-04-01" });

    expect(sql).toContain("weave_fireflies_recordings");
    expect(sql).toContain("matched_candidates");
    expect(sql).toContain("matched_applications");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("matched_candidates.ashby_candidate_id = c.ashby_candidate_id");
    expect(sql).toContain("matched_applications.ashby_application_id = app.ashby_application_id");
    expect(sql).toContain("2026-04-01");
  });

  it("ranks an obvious external email/name match first", () => {
    const candidates: CandidateApplicationContext[] = [
      {
        ashbyCandidateId: "cand_other",
        ashbyApplicationId: "app_other",
        ashbyJobId: "job_1",
        candidateName: "Patrick Robertson",
        primaryEmail: "patrick@example.com",
        emailAddresses: ["patrick@example.com"],
        profileUrl: null,
        applicationStatus: "Archived",
        currentInterviewStageTitle: "Initial Screen",
        applicationCreatedAt: "2026-05-01",
        applicationArchivedAt: null,
        evaluationInterviewDate: "2026-05-22",
        evaluationCandidateName: "Patrick Robertson",
        evaluationSum: "12",
        stageTitles: ["Initial Screen"],
        stageEnteredDates: ["2026-05-20"],
      },
      {
        ashbyCandidateId: "cand_patrick",
        ashbyApplicationId: "app_patrick",
        ashbyJobId: "job_1",
        candidateName: "Patrick S. Bacon",
        primaryEmail: "patrick@gmail.com",
        emailAddresses: ["patrick@gmail.com"],
        profileUrl: "https://app.ashbyhq.com/candidates/patrick",
        applicationStatus: "Archived",
        currentInterviewStageTitle: "Initial Screen",
        applicationCreatedAt: "2026-05-01",
        applicationArchivedAt: null,
        evaluationInterviewDate: "2026-05-22",
        evaluationCandidateName: "Patrick S. Bacon",
        evaluationSum: "14",
        stageTitles: ["Initial Screen"],
        stageEnteredDates: ["2026-05-20"],
      },
    ];

    const ranked = rankCandidateApplications(
      {
        firefliesTranscriptId: "tx_patrick",
        meetingDate: "2026-05-22",
        title: "Weave Engineering Intro chat - Patrick / Prakul",
        externalEmails: ["patrick.s.bacon@relational.ai"],
      },
      candidates,
    );

    expect(ranked[0]).toMatchObject({
      ashbyCandidateId: "cand_patrick",
      ashbyApplicationId: "app_patrick",
      confidence: "high",
    });
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
    expect(ranked[0]?.reasons).toContain("email_local_part_matches_candidate_name");
  });

  it("does not give substring email credit for very short name tokens", () => {
    const ranked = rankCandidateApplications(
      {
        firefliesTranscriptId: "tx_rishiraj",
        meetingDate: "2026-05-29",
        title: "Weave Engineering Intro chat - Rishiraj / Prakul",
        externalEmails: ["rajchan@umich.edu"],
      },
      [
        {
          ashbyCandidateId: "cand_false",
          ashbyApplicationId: "app_false",
          ashbyJobId: "job_1",
          candidateName: "Brian An",
          primaryEmail: null,
          emailAddresses: [],
          profileUrl: null,
          applicationStatus: "Archived",
          currentInterviewStageTitle: "Initial Screen",
          applicationCreatedAt: "2026-05-01",
          applicationArchivedAt: null,
          evaluationInterviewDate: null,
          evaluationCandidateName: null,
          evaluationSum: null,
          stageTitles: ["Initial Screen"],
          stageEnteredDates: [],
        },
      ],
    );

    expect(ranked[0]?.reasons).not.toContain("email_local_part_matches_candidate_last_name");
    expect(ranked[0]?.score).toBe(5);
  });
});
