import { timingSafeEqual } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { FastifyInstance } from "fastify";
import { validateWeaveCandidateEvaluationEvent } from "./payload.js";

export interface SqsLikeClient {
  send(command: unknown): Promise<unknown>;
}

export interface RegisterWeaveCandidateEvaluationRouteOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly sqs?: SqsLikeClient;
  readonly createSqsClient?: (region: string) => SqsLikeClient;
}

interface RouteConfig {
  readonly secret: string;
  readonly queueUrl: string;
  readonly organizationId: string;
  readonly region: string;
}

const defaultRegion = "us-west-1";
const webhookPath = "/integrations/weave/candidate-evaluations/webhook";

export function registerWeaveCandidateEvaluationRoutes(
  app: FastifyInstance,
  options: RegisterWeaveCandidateEvaluationRouteOptions = {},
): void {
  const env = options.env ?? process.env;
  let sqs: SqsLikeClient | undefined = options.sqs;

  app.post(webhookPath, async (request, reply) => {
    const config = routeConfigFromEnv(env);
    if (!config) {
      request.log.error("Weave candidate evaluation webhook is not configured");
      return reply.code(503).send({ error: "Webhook is not configured" });
    }

    const providedSecret = headerString(request.headers["x-puddle-webhook-secret"]);
    if (!providedSecret || !constantTimeSecretEquals(providedSecret, config.secret)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const body = parseBody(request.body);
    const validation = validateWeaveCandidateEvaluationEvent(body);
    if (!validation.ok) {
      request.log.warn(
        { reason: validation.reason },
        "invalid Weave candidate evaluation webhook payload",
      );
      return reply.code(400).send({ error: "Invalid Weave candidate evaluation event" });
    }

    sqs ??= (options.createSqsClient ?? ((region: string) => new SQSClient({ region })))(
      config.region,
    );
    const response = await sqs.send(
      new SendMessageCommand({
        QueueUrl: config.queueUrl,
        MessageBody: JSON.stringify({
          organizationId: config.organizationId,
          event: validation.event,
        }),
      }),
    );

    return reply.code(202).send({
      status: "queued",
      messageId: messageIdFromResponse(response),
    });
  });
}

function routeConfigFromEnv(env: NodeJS.ProcessEnv): RouteConfig | null {
  const secret = nonEmpty(env.WEAVE_CANDIDATE_EVALUATION_WEBHOOK_SECRET);
  const queueUrl = nonEmpty(env.WEAVE_CANDIDATE_EVALUATION_QUEUE_URL);
  const organizationId = nonEmpty(env.WEAVE_CANDIDATE_EVALUATION_ORG_ID);
  if (!secret || !queueUrl || !organizationId) {
    return null;
  }

  return {
    secret,
    queueUrl,
    organizationId,
    region: nonEmpty(env.AWS_REGION) ?? defaultRegion,
  };
}

function headerString(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function constantTimeSecretEquals(providedSecret: string, expectedSecret: string): boolean {
  const expected = Buffer.from(expectedSecret);
  const provided = Buffer.from(providedSecret);
  const comparable = Buffer.alloc(expected.length);
  provided.copy(comparable, 0, 0, Math.min(provided.length, expected.length));
  const matches = timingSafeEqual(comparable, expected);
  return matches && provided.length === expected.length;
}

function parseBody(body: unknown): unknown {
  if (typeof body !== "string") {
    return body;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function messageIdFromResponse(response: unknown): string | null {
  const messageId = (response as { MessageId?: unknown }).MessageId;
  return typeof messageId === "string" ? messageId : null;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}
