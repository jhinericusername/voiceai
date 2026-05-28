export function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

export function emailDomain(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  if (!normalized || atIndex < 1 || atIndex === normalized.length - 1) {
    return null;
  }

  return normalized.slice(atIndex + 1);
}

export function isAllowedEmailForDomains(
  email: string | null | undefined,
  allowedDomains: readonly string[],
): boolean {
  const domain = emailDomain(email);
  return domain ? allowedDomains.includes(domain) : false;
}
