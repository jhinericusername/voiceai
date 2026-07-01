import { DeleteMessageCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
import {
  parseWeaveCandidateEvaluationMessageBody,
  processWeaveCandidateEvaluationMessage,
  runWeaveCandidateEvaluationWorker,
  type WeaveCandidateEvaluationSqsMessage,
} from "../src/weave/candidate-evaluations/worker.js";
import type {
  ProcessWeaveCandidateEvaluationInput,
  ProcessWeaveCandidateEvaluationResult,
} from "../src/weave/candidate-evaluations/processor.js";

const queueUrl = "https://sqs.us-west-1.amazonaws.com/123/weave-candidate-evaluations";
const organizationId = "org_01KV4FF7KX24B76H7Q57QVB5CT";

class FakeSqsClient {
  readonly commands: unknown[] = [];

  constructor(private readonly messages: readonly WeaveCandidateEvaluationSqsMessage[] = []) {}

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    if (command instanceof ReceiveMessageCommand) {
      return {
        Messages: this.messages.map((message) => ({
          Body: message.body,
          ReceiptHandle: message.receiptHandle,
        })),
      };
    }
    if (command instanceof DeleteMessageCommand) {
      return {};
    }
    throw new Error(`Unexpected command: ${command?.constructor?.name ?? typeof command}`);
  }
}

describe("Weave candidate evaluation worker", () => {
  it("parses and validates message bodies", () => {
    const parsed = parseWeaveCandidateEvaluationMessageBody(messageBody());

    expect(parsed).toMatchObject({
      organizationId,
      event: {
        eventId: "evt_1",
        evaluation: {
          sourceEvaluationId: "eval_1",
          totalScore: 12,
          comments: "Strong technical screen.",
        },
      },
    });
  });

  it("processes valid messages and deletes them after success", async () => {
    const sqs = new FakeSqsClient();
    const processed: ProcessWeaveCandidateEvaluationInput[] = [];

    const result = await processWeaveCandidateEvaluationMessage({
      message: { body: messageBody(), receiptHandle: "receipt-1" },
      queueUrl,
      sqs,
      pool: fakePool,
      process: async (input) => {
        processed.push(input);
        return processResult(input);
      },
    });

    expect(result).toEqual({
      status: "processed",
      organizationId,
      eventId: "evt_1",
    });
    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({ pool: fakePool, organizationId });
    expect(commandNames(sqs)).toEqual(["DeleteMessageCommand"]);
    expect((sqs.commands[0] as DeleteMessageCommand).input).toMatchObject({
      QueueUrl: queueUrl,
      ReceiptHandle: "receipt-1",
    });
  });

  it("does not delete when the processor fails", async () => {
    const sqs = new FakeSqsClient();

    await expect(
      processWeaveCandidateEvaluationMessage({
        message: { body: messageBody(), receiptHandle: "receipt-1" },
        queueUrl,
        sqs,
        pool: fakePool,
        process: async () => {
          throw new Error("database failed after comments: sensitive text");
        },
      }),
    ).rejects.toThrow("database failed after comments");

    expect(commandNames(sqs)).not.toContain("DeleteMessageCommand");
  });

  it("does not delete invalid message bodies", async () => {
    const sqs = new FakeSqsClient();

    await expect(
      processWeaveCandidateEvaluationMessage({
        message: { body: JSON.stringify({ organizationId, event: { eventId: "evt_bad" } }), receiptHandle: "receipt-1" },
        queueUrl,
        sqs,
        pool: fakePool,
        process: async (input) => processResult(input),
      }),
    ).rejects.toThrow("Invalid Weave candidate evaluation message");

    expect(commandNames(sqs)).not.toContain("DeleteMessageCommand");
  });

  it("run-once polls the queue and processes received messages", async () => {
    const sqs = new FakeSqsClient([{ body: messageBody(), receiptHandle: "receipt-1" }]);
    const processed: ProcessWeaveCandidateEvaluationInput[] = [];
    const logs: string[] = [];

    await runWeaveCandidateEvaluationWorker({
      once: true,
      env: {
        WEAVE_CANDIDATE_EVALUATION_QUEUE_URL: queueUrl,
        AWS_REGION: "us-west-2",
      },
      sqs,
      pool: fakePool,
      write: (message) => logs.push(message),
      pollWaitSeconds: 0,
      maxNumberOfMessages: 1,
      process: async (input) => {
        processed.push(input);
        return processResult(input);
      },
    });

    expect(commandNames(sqs)).toEqual(["ReceiveMessageCommand", "DeleteMessageCommand"]);
    expect((sqs.commands[0] as ReceiveMessageCommand).input).toMatchObject({
      QueueUrl: queueUrl,
      WaitTimeSeconds: 0,
      MaxNumberOfMessages: 1,
    });
    expect(processed).toHaveLength(1);
    expect(logs.join("")).toContain("status=processed");
    expect(logs.join("")).toContain("event_id=evt_1");
  });
});

const fakePool = { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) };

function processResult(
  input: ProcessWeaveCandidateEvaluationInput,
): ProcessWeaveCandidateEvaluationResult {
  return {
    status: "synced",
    sourceEvaluationId: input.event.evaluation.sourceEvaluationId,
    applicationId: input.event.evaluation.ashbyApplicationId,
    scoreId: "score_1",
  };
}

function messageBody(): string {
  return JSON.stringify({
    organizationId,
    event: validRawEvent(),
  });
}

function validRawEvent() {
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

function commandNames(client: FakeSqsClient): string[] {
  return client.commands.map((command) => command?.constructor?.name ?? typeof command);
}
