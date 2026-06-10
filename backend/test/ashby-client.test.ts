import { describe, expect, it } from "vitest";
import {
  listActiveApplicationsForJob,
  syncedApplicationFromAshby,
} from "../src/ashby/client.js";

describe("Ashby API client", () => {
  it("maps Ashby applications into synced applications", () => {
    const synced = syncedApplicationFromAshby({
      integrationId: "int_1",
      application: {
        id: "app_1",
        status: "Active",
        updatedAt: "2026-06-10T12:00:00.000Z",
        candidate: {
          id: "cand_1",
          name: "Maya Chen",
          primaryEmailAddress: "maya@example.com",
        },
        job: { id: "job_1" },
        currentInterviewStage: { name: "Phone Screen" },
        source: { title: "Inbound" },
      },
    });

    expect(synced).toEqual({
      applicationId: "app_1",
      integrationId: "int_1",
      candidateId: "cand_1",
      candidateName: "Maya Chen",
      candidateEmail: "maya@example.com",
      jobId: "job_1",
      currentStage: "Phone Screen",
      source: "Inbound",
      status: "Active",
      ashbyUpdatedAt: "2026-06-10T12:00:00.000Z",
      rawPayload: expect.objectContaining({ id: "app_1" }),
    });
  });

  it("falls back to candidate first and last name plus stage and source names", () => {
    const synced = syncedApplicationFromAshby({
      integrationId: "int_1",
      application: {
        id: "app_2",
        candidate: {
          id: "cand_2",
          firstName: "Noor",
          lastName: "Patel",
          email: "noor@example.com",
        },
        jobId: "job_2",
        stage: { name: "Final" },
        source: { name: "Referral" },
      },
    });

    expect(synced).toEqual({
      applicationId: "app_2",
      integrationId: "int_1",
      candidateId: "cand_2",
      candidateName: "Noor Patel",
      candidateEmail: "noor@example.com",
      jobId: "job_2",
      currentStage: "Final",
      source: "Referral",
      status: "Active",
      ashbyUpdatedAt: null,
      rawPayload: expect.objectContaining({ id: "app_2" }),
    });
  });

  it("returns null for malformed applications missing required identifiers", () => {
    expect(
      syncedApplicationFromAshby({
        integrationId: "int_1",
        application: {
          id: "app_1",
          candidate: { name: "Missing Candidate Id" },
          jobId: "job_1",
        },
      }),
    ).toBeNull();
    expect(
      syncedApplicationFromAshby({
        integrationId: "int_1",
        application: {
          id: "app_1",
          candidate: { id: "cand_1", name: "Missing Job" },
        },
      }),
    ).toBeNull();
  });

  it("requests active applications with HTTP Basic auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          success: true,
          results: [
            {
              id: "app_1",
              status: "Active",
              candidate: { id: "cand_1", name: "Maya Chen" },
              jobId: "job_1",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await listActiveApplicationsForJob({
      apiKey: "ashby-key",
      integrationId: "int_1",
      jobId: "job_1",
      fetchImpl: fakeFetch as typeof fetch,
    });

    expect(result).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.ashbyhq.com/application.list");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("ashby-key:").toString("base64")}`,
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ jobId: "job_1", status: "Active" });
  });

  it("paginates through active applications until Ashby stops returning cursors", async () => {
    const bodies: unknown[] = [];
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const isFirstPage = bodies.length === 1;
      return new Response(
        JSON.stringify({
          success: true,
          results: [
            {
              id: isFirstPage ? "app_1" : "app_2",
              candidate: {
                id: isFirstPage ? "cand_1" : "cand_2",
                name: isFirstPage ? "Maya Chen" : "Noor Patel",
              },
              jobId: "job_1",
            },
          ],
          moreDataAvailable: isFirstPage,
          nextCursor: isFirstPage ? "cursor_2" : null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await listActiveApplicationsForJob({
      apiKey: "ashby-key",
      integrationId: "int_1",
      jobId: "job_1",
      fetchImpl: fakeFetch as typeof fetch,
    });

    expect(result.map((application) => application.applicationId)).toEqual(["app_1", "app_2"]);
    expect(bodies).toEqual([
      { jobId: "job_1", status: "Active" },
      { jobId: "job_1", status: "Active", cursor: "cursor_2" },
    ]);
  });

  it("ignores malformed records returned from Ashby", async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          results: [
            { id: "bad_app", candidate: { name: "Missing Candidate Id" }, jobId: "job_1" },
            { id: "app_1", candidate: { id: "cand_1", name: "Maya Chen" }, jobId: "job_1" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const result = await listActiveApplicationsForJob({
      apiKey: "ashby-key",
      integrationId: "int_1",
      jobId: "job_1",
      fetchImpl: fakeFetch as typeof fetch,
    });

    expect(result.map((application) => application.applicationId)).toEqual(["app_1"]);
  });

  it("throws when Ashby returns a non-OK response", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ success: false, error: "denied" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });

    await expect(
      listActiveApplicationsForJob({
        apiKey: "bad-key",
        integrationId: "int_1",
        jobId: "job_1",
        fetchImpl: fakeFetch as typeof fetch,
      }),
    ).rejects.toThrow("Ashby application.list failed with 401");
  });

  it("throws when Ashby returns a successful HTTP response with an API error payload", async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          errorInfo: { code: "invalid_api_key", message: "Invalid API key" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    await expect(
      listActiveApplicationsForJob({
        apiKey: "bad-key",
        integrationId: "int_1",
        jobId: "job_1",
        fetchImpl: fakeFetch as typeof fetch,
      }),
    ).rejects.toThrow("Ashby application.list failed: Invalid API key");
  });
});
