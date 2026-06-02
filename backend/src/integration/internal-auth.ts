import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const PROTECTED_POST_PATHS = [
  "/integration/",
  "/candidate/invites/",
  "/internal/",
] as const;

function bearerToken(header: string | undefined): string | null {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) {
    return null;
  }

  const token = header.slice(prefix.length).trim();
  return token || null;
}

function requiresInternalAuth(request: FastifyRequest): boolean {
  if (request.method !== "POST") {
    return false;
  }

  if (request.url === "/sessions") {
    return true;
  }

  return PROTECTED_POST_PATHS.some((path) => request.url.startsWith(path));
}

export function internalAuthTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const token = env.PUDDLE_BACKEND_INTERNAL_TOKEN?.trim();
  return token || undefined;
}

export function hasValidInternalAuth(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  return bearerToken(authorizationHeader) === expectedToken;
}

export function registerInternalAuth(
  app: FastifyInstance,
  expectedToken = internalAuthTokenFromEnv(),
): void {
  if (!expectedToken) {
    return;
  }

  app.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requiresInternalAuth(request)) {
        return;
      }

      if (!hasValidInternalAuth(request.headers.authorization, expectedToken)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    },
  );
}
