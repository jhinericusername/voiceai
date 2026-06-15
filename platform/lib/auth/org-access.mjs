const DASHBOARD_VIEW_PERMISSIONS = new Set(["dashboard:view"]);
const DASHBOARD_VIEW_ROLES = new Set(["member", "admin", "owner", "organization_admin", "org_admin"]);
const ASHBY_ONBOARDING_PERMISSIONS = new Set([
  "integrations:manage",
  "ashby:onboarding:manage",
  "ashby:manage",
  "organization:admin",
]);
const ADMIN_ROLES = new Set(["admin", "owner", "organization_admin", "org_admin"]);
const TEAM_INVITE_PERMISSIONS = new Set(["team:invite", "organization:admin"]);

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedStrings(value) {
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

function configuredAdminEmails(env) {
  return new Set(
    (env.PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function sessionOrganizationId(session) {
  const organizationId = stringValue(objectValue(session).organizationId);
  return organizationId || null;
}

export function sessionEmail(session) {
  const user = objectValue(objectValue(session).user);
  const email = stringValue(user.email).toLowerCase();
  return email || null;
}

export function sessionRoles(session) {
  const sessionObject = objectValue(session);
  const user = objectValue(sessionObject.user);
  return [
    ...normalizedStrings(sessionObject.role),
    ...normalizedStrings(sessionObject.roles),
    ...normalizedStrings(user.role),
    ...normalizedStrings(user.roles),
  ];
}

export function sessionPermissions(session) {
  const sessionObject = objectValue(session);
  const user = objectValue(sessionObject.user);
  return [
    ...normalizedStrings(sessionObject.permissions),
    ...normalizedStrings(user.permissions),
  ];
}

export function hasOrgRole(session, allowedRoles) {
  if (!sessionOrganizationId(session)) {
    return false;
  }

  return sessionRoles(session).some((role) => allowedRoles.has(role));
}

export function hasOrgPermission(session, permission) {
  if (!sessionOrganizationId(session)) {
    return false;
  }

  const normalizedPermission = stringValue(permission).toLowerCase();
  return Boolean(normalizedPermission) && sessionPermissions(session).includes(normalizedPermission);
}

function hasAnyOrgPermission(session, permissions) {
  if (!sessionOrganizationId(session)) {
    return false;
  }

  return sessionPermissions(session).some((permission) => permissions.has(permission));
}

export function canViewDashboard(session) {
  return (
    hasAnyOrgPermission(session, DASHBOARD_VIEW_PERMISSIONS) ||
    hasOrgRole(session, DASHBOARD_VIEW_ROLES)
  );
}

export function canUseBootstrapAdminEmail(session, env = process.env) {
  if (env.PUDDLE_ALLOW_BOOTSTRAP_ADMINS !== "true" || !sessionOrganizationId(session)) {
    return false;
  }

  const email = sessionEmail(session);
  return Boolean(email && configuredAdminEmails(env).has(email));
}

export function canManageAshbyOnboardingAccess(session, env = process.env) {
  return (
    hasAnyOrgPermission(session, ASHBY_ONBOARDING_PERMISSIONS) ||
    hasOrgRole(session, ADMIN_ROLES) ||
    canUseBootstrapAdminEmail(session, env)
  );
}

export function canInviteTeam(session) {
  return hasAnyOrgPermission(session, TEAM_INVITE_PERMISSIONS) || hasOrgRole(session, ADMIN_ROLES);
}
