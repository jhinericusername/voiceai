import "server-only";

const ALLOWED_ASHBY_ONBOARDING_ROLES = new Set([
  "admin",
  "owner",
  "organization_admin",
  "org_admin",
]);

const ALLOWED_ASHBY_ONBOARDING_PERMISSIONS = new Set([
  "integrations:manage",
  "ashby:onboarding:manage",
  "ashby:manage",
  "organization:admin",
]);

export const ASHBY_ONBOARDING_ADMIN_DENIED_ERROR =
  "Ashby onboarding setup requires a workspace admin or owner.";

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value.trim().toLowerCase()].filter(Boolean);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean);
}

function configuredAdminEmails(): Set<string> {
  return new Set(
    (process.env.PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function canManageAshbyOnboarding(session: unknown): boolean {
  const sessionObject = objectValue(session);
  const user = objectValue(sessionObject?.user);
  if (!sessionObject || !user) {
    return false;
  }

  const email = stringValue(user.email)?.toLowerCase();
  if (email && configuredAdminEmails().has(email)) {
    return true;
  }

  const roles = [
    ...normalizedStrings(sessionObject.role),
    ...normalizedStrings(sessionObject.roles),
    ...normalizedStrings(user.role),
    ...normalizedStrings(user.roles),
  ];
  if (roles.some((role) => ALLOWED_ASHBY_ONBOARDING_ROLES.has(role))) {
    return true;
  }

  const permissions = [
    ...normalizedStrings(sessionObject.permissions),
    ...normalizedStrings(user.permissions),
  ];
  return permissions.some((permission) => ALLOWED_ASHBY_ONBOARDING_PERMISSIONS.has(permission));
}
