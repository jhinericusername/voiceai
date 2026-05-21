import type { FastifyInstance } from "fastify";
import {
  validateCreateSessionRequest,
  type CreateSessionRequest,
} from "./contract.js";

// The platform-facing REST surface. Session creation is delegated to the
// Scheduler routes; this validates the contract before handing off.
export function registerIntegrationRoutes(
  app: FastifyInstance,
  onValidRequest: (body: CreateSessionRequest) => Promise<{ sessionId: string }>,
): void {
  app.post<{ Body: CreateSessionRequest }>(
    "/integration/sessions",
    async (request, reply) => {
      const validation = validateCreateSessionRequest(request.body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }
      const result = await onValidRequest(request.body);
      return reply.code(201).send(result);
    },
  );
}
