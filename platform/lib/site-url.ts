export function publicBaseUrl(): string {
  return (
    process.env.PUDDLE_PUBLIC_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function workosRedirectUri(): string {
  return (
    process.env.PUDDLE_WORKOS_REDIRECT_URI ??
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ??
    `${publicBaseUrl()}/callback`
  ).trim();
}

export function absoluteSiteUrl(path: string): string {
  return new URL(path, `${publicBaseUrl()}/`).toString();
}
