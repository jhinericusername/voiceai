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

export function emailDomain(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  const atIndex = normalized?.lastIndexOf("@") ?? -1;
  if (!normalized || atIndex < 1 || atIndex === normalized.length - 1) {
    return null;
  }

  return normalized.slice(atIndex + 1);
}

export function isAllowedAuthEmail(email: string | null | undefined): boolean {
  const domain = emailDomain(email);
  return domain ? allowedAuthDomains().includes(domain) : false;
}

export function allowedAuthDomainsLabel(): string {
  return allowedAuthDomains().join(", ");
}
