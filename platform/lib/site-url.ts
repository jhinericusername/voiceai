const DEFAULT_PUBLIC_BASE_URL = "http://localhost:3000";

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const rawBaseUrl = (
    env.PUDDLE_PUBLIC_BASE_URL ??
    env.NEXT_PUBLIC_SITE_URL ??
    DEFAULT_PUBLIC_BASE_URL
  ).trim();
  const parsedBaseUrl = new URL(rawBaseUrl);

  if (isProduction(env) && parsedBaseUrl.protocol !== "https:") {
    throw new Error("PUDDLE_PUBLIC_BASE_URL must use https in production");
  }

  if (isProduction(env) && isLocalhost(parsedBaseUrl.hostname)) {
    throw new Error("PUDDLE_PUBLIC_BASE_URL must not point to localhost in production");
  }

  return parsedBaseUrl.toString().replace(/\/$/, "");
}

export function workosRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.PUDDLE_WORKOS_REDIRECT_URI ??
    env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ??
    `${publicBaseUrl(env)}/callback`
  ).trim();
}

export function absoluteSiteUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return new URL(path, `${publicBaseUrl(env)}/`).toString();
}
