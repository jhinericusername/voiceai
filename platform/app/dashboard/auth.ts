import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import {
  canViewDashboard,
  hasOrgPermission,
  sessionOrganizationId,
} from "@/lib/auth/org-access.mjs";

export type OrgPermission = "dashboard:view" | "ashby:onboarding:manage" | "team:invite";

export async function requireDashboardUser(returnTo = "/dashboard") {
  const session = await withAuth();

  if (!session.user) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (!canViewDashboard(session)) {
    redirect("/not-authorized?reason=invitation");
  }

  const organizationId = sessionOrganizationId(session);
  if (!organizationId) {
    redirect("/not-authorized?reason=invitation");
  }
  const displayName =
    [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || session.user.email;

  return {
    ...session,
    user: session.user,
    organizationId,
    displayName,
  };
}

export async function requireOrgMember(returnTo = "/dashboard") {
  return requireDashboardUser(returnTo);
}

export async function requireOrgPermission(permission: OrgPermission, returnTo = "/dashboard") {
  const session = await requireDashboardUser(returnTo);
  if (!hasOrgPermission(session, permission)) {
    redirect("/not-authorized?reason=permission");
  }

  return session;
}
