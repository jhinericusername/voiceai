import { describe, expect, it, vi } from "vitest";
import {
  ashbyApiErrorLogFields,
  ashbyApiKeyValidationErrorMessage,
  listActiveApplicationsForJob,
  listJobs,
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

  it("uses Ashby's current interview stage title when syncing applications", () => {
    const synced = syncedApplicationFromAshby({
      integrationId: "int_1",
      application: {
        id: "app_3",
        candidate: { id: "cand_3", name: "Iris Kim" },
        jobId: "job_3",
        currentInterviewStage: { id: "stage_1", title: "Initial Screen" },
        status: "Active",
      },
    });

    expect(synced?.currentStage).toBe("Initial Screen");
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

  it("throws when Ashby application.list repeats a pagination cursor", async () => {
    const bodies: unknown[] = [];
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length > 2) {
        throw new Error("test detected repeated application cursor loop");
      }

      return new Response(
        JSON.stringify({
          success: true,
          results: [
            {
              id: `app_${bodies.length}`,
              candidate: { id: `cand_${bodies.length}`, name: `Candidate ${bodies.length}` },
              jobId: "job_1",
            },
          ],
          moreDataAvailable: true,
          nextCursor: "repeated_cursor",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    await expect(
      listActiveApplicationsForJob({
        apiKey: "ashby-key",
        integrationId: "int_1",
        jobId: "job_1",
        fetchImpl: fakeFetch as typeof fetch,
      }),
    ).rejects.toThrow("Ashby application.list pagination repeated cursor");
    expect(bodies).toEqual([
      { jobId: "job_1", status: "Active" },
      { jobId: "job_1", status: "Active", cursor: "repeated_cursor" },
    ]);
  });

  it("throws when Ashby application.list exceeds the pagination safety limit", async () => {
    let page = 0;
    const fakeFetch = async () => {
      page += 1;
      if (page > 105) {
        throw new Error("test detected unbounded application.list pagination");
      }

      return new Response(
        JSON.stringify({
          success: true,
          results: [
            {
              id: "app_1",
              candidate: { id: "cand_1", name: "Maya Chen" },
              jobId: "job_1",
            },
          ],
          moreDataAvailable: true,
          nextCursor: `cursor_${page}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    await expect(
      listActiveApplicationsForJob({
        apiKey: "ashby-key",
        integrationId: "int_1",
        jobId: "job_1",
        fetchImpl: fakeFetch as typeof fetch,
      }),
    ).rejects.toThrow("Ashby application.list exceeded maximum pagination limit");
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
    ).rejects.toThrow("Ashby application.list failed with 200: Invalid API key");
  });

  it("lists only open jobs with the Ashby API key for onboarding", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          success: true,
          results: [
            { id: "job_1", name: "Founding Engineer", status: "Open" },
            { id: "job_2", title: "Designer", status: "Closed" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await expect(listJobs({ apiKey: "ashby-key", fetchImpl })).resolves.toEqual([
      { id: "job_1", name: "Founding Engineer", status: "Open" },
    ]);

    expect(calls[0]?.url).toBe("https://api.ashbyhq.com/job.list");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ status: ["Open"] });
    expect(calls[0]?.init.headers).toMatchObject({
      accept: "application/json; version=1",
      authorization: `Basic ${Buffer.from("ashby-key:").toString("base64")}`,
      "content-type": "application/json",
    });
  });

  it("paginates through Ashby job.list and filters closed or archived jobs", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const isFirstPage = bodies.length === 1;

      return new Response(
        JSON.stringify({
          success: true,
          results: isFirstPage
            ? [
                { id: "job_1", name: "Founding Engineer", status: "Open" },
                { id: "job_2", name: "Designer", status: "Closed" },
              ]
            : [
                { id: "job_3", title: "Product Engineer", status: "open" },
                { id: "job_4", name: "Archived Role", status: "Archived" },
              ],
          moreDataAvailable: isFirstPage,
          nextCursor: isFirstPage ? "cursor_2" : null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await expect(listJobs({ apiKey: "ashby-key", fetchImpl })).resolves.toEqual([
      { id: "job_1", name: "Founding Engineer", status: "Open" },
      { id: "job_3", name: "Product Engineer", status: "open" },
    ]);

    expect(bodies).toEqual([{ status: ["Open"] }, { status: ["Open"], cursor: "cursor_2" }]);
  });

  it("throws when Ashby job.list repeats a pagination cursor", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length > 2) {
        throw new Error("test detected repeated cursor loop");
      }
      return new Response(
        JSON.stringify({
          success: true,
          results: [{ id: `job_${bodies.length}`, name: `Role ${bodies.length}`, status: "Open" }],
          moreDataAvailable: true,
          nextCursor: "repeated_cursor",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await expect(listJobs({ apiKey: "ashby-key", fetchImpl })).rejects.toThrow(
      "Ashby job.list pagination repeated cursor",
    );
    expect(bodies).toEqual([
      { status: ["Open"] },
      { status: ["Open"], cursor: "repeated_cursor" },
    ]);
  });

  it("throws when Ashby job.list exceeds the pagination safety limit", async () => {
    let page = 0;
    const fetchImpl = vi.fn(async () => {
      page += 1;
      if (page > 105) {
        throw new Error("test detected unbounded job.list pagination");
      }

      return new Response(
        JSON.stringify({
          success: true,
          results: [{ id: "job_1", name: "Founding Engineer", status: "Open" }],
          moreDataAvailable: true,
          nextCursor: `cursor_${page}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await expect(listJobs({ apiKey: "ashby-key", fetchImpl })).rejects.toThrow(
      "Ashby job.list exceeded maximum pagination limit",
    );
  });

  it("throws when Ashby job.list returns a non-OK response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: "denied" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(listJobs({ apiKey: "bad-key", fetchImpl })).rejects.toThrow(
      "Ashby job.list failed with 401",
    );
  });

  it("surfaces Ashby job.list permission failures", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, errorInfo: { message: "missing_endpoint_permission" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(listJobs({ apiKey: "ashby-key", fetchImpl })).rejects.toThrow(
      /missing_endpoint_permission/,
    );
  });

  it("formats safe Ashby validation diagnostics without exposing free-form upstream text", async () => {
    const permissionFetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, errorInfo: { message: "missing_endpoint_permission" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const secretFetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, errorInfo: { message: "secret tenant token detail" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    let permissionError: unknown;
    try {
      await listJobs({ apiKey: "ashby-key", fetchImpl: permissionFetch });
    } catch (error) {
      permissionError = error;
    }

    expect(ashbyApiErrorLogFields(permissionError)).toEqual({
      ashbyEndpoint: "job.list",
      ashbyStatus: 200,
      ashbyMessage: "missing_endpoint_permission",
    });
    expect(ashbyApiKeyValidationErrorMessage(permissionError)).toBe(
      "Ashby rejected job.list (200): missing_endpoint_permission. Confirm the API key belongs to the correct Ashby workspace and can read jobs.",
    );

    let secretError: unknown;
    try {
      await listJobs({ apiKey: "ashby-key", fetchImpl: secretFetch });
    } catch (error) {
      secretError = error;
    }

    expect(ashbyApiErrorLogFields(secretError)).toEqual({
      ashbyEndpoint: "job.list",
      ashbyStatus: 403,
    });
    expect(ashbyApiKeyValidationErrorMessage(secretError)).toBe(
      "Ashby rejected job.list (403). Confirm the API key belongs to the correct Ashby workspace and can read jobs.",
    );
  });
});
