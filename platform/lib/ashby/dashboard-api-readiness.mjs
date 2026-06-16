const ORG_REQUIRED_ERROR = "You need an invitation to access this workspace.";
const SETUP_REQUIRED_ERROR = "Complete Ashby onboarding before using dashboard actions.";

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function requireAshbyReadyDashboardApiAccess(context) {
  const session = objectValue(await context.withAuth());
  const user = objectValue(session.user);
  const email = stringValue(user.email);

  if (!email) {
    return {
      response: context.responseJson({ error: "Not signed in." }, 401),
    };
  }

  if (!context.canViewDashboard(session)) {
    return {
      response: context.responseJson({ error: ORG_REQUIRED_ERROR }, 403),
    };
  }

  const organizationId = stringValue(context.sessionOrganizationId(session));
  if (!organizationId) {
    return {
      response: context.responseJson({ error: ORG_REQUIRED_ERROR }, 403),
    };
  }

  let identity;
  try {
    identity = context.companyIdentityFromUser({ email, organizationId });
  } catch {
    return {
      response: context.responseJson({ error: ORG_REQUIRED_ERROR }, 403),
    };
  }

  let ashbyState;
  try {
    ashbyState = await context.getAshbyCompanyState(identity);
  } catch {
    return {
      response: context.responseJson({ error: "Ashby setup status is unavailable." }, 502),
    };
  }

  if (!context.isAshbyDashboardReady(ashbyState)) {
    return {
      response: context.responseJson({ error: SETUP_REQUIRED_ERROR }, 409),
    };
  }

  return {
    response: null,
    session,
    user,
    organizationId,
    identity,
    ashbyState,
  };
}
