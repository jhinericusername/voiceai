import { isAllowedEmailForDomains } from "./email-domain";

const DEFAULT_ALLOWED_AUTH_DOMAINS = ["usepuddle.com", "workweave.ai"] as const;

export function allowedAuthDomains(): readonly string[] {
  const configured = process.env.PUDDLE_ALLOWED_AUTH_DOMAINS?.trim();
  if (!configured) {
    return DEFAULT_ALLOWED_AUTH_DOMAINS;
  }

  const domains = configured
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  return domains.length ? domains : DEFAULT_ALLOWED_AUTH_DOMAINS;
}

export function isAllowedAuthEmail(email: string | null | undefined): boolean {
  return isAllowedEmailForDomains(email, allowedAuthDomains());
}

export function allowedAuthDomainsLabel(): string {
  return allowedAuthDomains().join(", ");
}
