import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const PROTECTED_POST_PATHS = [
  "/integration/",
  "/integrations/",
  "/candidate/invites/",
  "/grading/",
] as const;
const INTERNAL_AUTH_EXEMPT_POST_PATHS = [
  "/integrations/weave/candidate-evaluations/webhook",
] as const;

function bearerToken(header: string | undefined): string | null {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) {
    return null;
  }

  const token = header.slice(prefix.length).trim();
  return token || null;
}

export function internalRouteRequiresAuth(method: string, url: string): boolean {
  const path = requestPath(url);

  if (path.startsWith("/internal/")) {
    return true;
  }

  if (method !== "POST") {
    return false;
  }

  if (path === "/sessions") {
    return true;
  }

  if (INTERNAL_AUTH_EXEMPT_POST_PATHS.some((exemptPath) => path === exemptPath)) {
    return false;
  }

  return PROTECTED_POST_PATHS.some((protectedPath) => path.startsWith(protectedPath));
}

function requestPath(url: string): string {
  return url.split("?", 1)[0] ?? url;
}

function requiresInternalAuth(request: FastifyRequest): boolean {
  return internalRouteRequiresAuth(request.method, request.url);
}

export function internalAuthTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const token = env.PUDDLE_BACKEND_INTERNAL_TOKEN?.trim();
  if (!token && env.NODE_ENV === "production") {
    throw new Error("PUDDLE_BACKEND_INTERNAL_TOKEN must be set in production");
  }
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
