import { SendMessageCommand } from "@aws-sdk/client-sqs";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerWeaveCandidateEvaluationRoutes } from "../src/weave/candidate-evaluations/routes.js";

const queueUrl = "https://sqs.us-west-1.amazonaws.com/123/weave-candidate-evaluations";
const organizationId = "org_01KV4FF7KX24B76H7Q57QVB5CT";
const webhookSecret = "super-secret-webhook-value";

class FakeSqsClient {
  readonly commands: unknown[] = [];

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    if (command instanceof SendMessageCommand) {
      return { MessageId: "msg_123" };
    }
    throw new Error(`Unexpected command: ${command?.constructor?.name ?? typeof command}`);
  }
}

describe("Weave candidate evaluation webhook routes", () => {
  it("rejects missing or wrong webhook secrets", async () => {
    const sqs = new FakeSqsClient();
    const app = routeApp(sqs);
    try {
      const missing = await app.inject({
        method: "POST",
        url: "/integrations/weave/candidate-evaluations/webhook",
        headers: { "content-type": "application/json" },
        payload: validPayload(),
      });
      const wrong = await app.inject({
        method: "POST",
        url: "/integrations/weave/candidate-evaluations/webhook",
        headers: {
          "content-type": "application/json",
          "x-puddle-webhook-secret": "wrong-secret",
        },
        payload: validPayload(),
      });

      expect(missing.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(401);
      expect(sqs.commands).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("enqueues valid events and returns the SQS message id", async () => {
    const sqs = new FakeSqsClient();
    const app = routeApp(sqs);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/weave/candidate-evaluations/webhook",
        headers: {
          "content-type": "application/json",
          "x-puddle-webhook-secret": webhookSecret,
        },
        payload: validPayload(),
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: "queued", messageId: "msg_123" });
      expect(sqs.commands).toHaveLength(1);
      const command = sqs.commands[0];
      expect(command).toBeInstanceOf(SendMessageCommand);
      expect((command as SendMessageCommand).input.QueueUrl).toBe(queueUrl);
      expect(JSON.parse(String((command as SendMessageCommand).input.MessageBody))).toMatchObject({
        organizationId,
        event: {
          eventId: "evt_1",
          operation: "INSERT",
          evaluation: {
            sourceEvaluationId: "eval_1",
            candidateName: "Ada Lovelace",
            totalScore: 12,
            ashbyApplicationId: "app_1",
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it("rejects invalid payloads without enqueueing", async () => {
    const sqs = new FakeSqsClient();
    const app = routeApp(sqs);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/weave/candidate-evaluations/webhook",
        headers: {
          "content-type": "application/json",
          "x-puddle-webhook-secret": webhookSecret,
        },
        payload: { eventId: "evt_bad", source: "wrong", record: {} },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Invalid Weave candidate evaluation event" });
      expect(sqs.commands).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

function routeApp(sqs: FakeSqsClient) {
  const app = Fastify();
  registerWeaveCandidateEvaluationRoutes(app, {
    sqs,
    env: {
      WEAVE_CANDIDATE_EVALUATION_WEBHOOK_SECRET: webhookSecret,
      WEAVE_CANDIDATE_EVALUATION_QUEUE_URL: queueUrl,
      WEAVE_CANDIDATE_EVALUATION_ORG_ID: organizationId,
    },
  });
  return app;
}

function validPayload() {
  return {
    eventId: "evt_1",
    source: "weave_supabase_candidate_evaluation",
    operation: "INSERT",
    record: {
      id: "eval_1",
      candidate_name: "Ada Lovelace",
      interview_date: "2026-06-15",
      problem_solving: 3,
      agency: 3,
      competitiveness: 3,
      curious: 3,
      comments: "Strong technical screen.",
      ashby_application_id: "app_1",
      ashby_candidate_id: "cand_1",
      ashby_job_id: "job_1",
      created_at: "2026-06-15T10:00:00.000Z",
      updated_at: "2026-06-15T10:05:00.000Z",
    },
  };
}
