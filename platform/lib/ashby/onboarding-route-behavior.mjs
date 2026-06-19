const ADMIN_DENIED_ERROR = "Ashby onboarding setup requires a workspace admin or owner.";
const BACKEND_UNREACHABLE_ERROR = "Interview backend is not reachable.";
const ORG_REQUIRED_ERROR = "You need an invitation to access this workspace.";
const ONBOARDING_BACKEND_ERROR = "Ashby onboarding request failed.";
const SYNC_BACKEND_ERROR = "Ashby sync request failed.";

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function safeBackendError(payload, fallback) {
  const error = stringValue(objectValue(payload).error).trim();
  if (!error || error.length > 300) {
    return fallback;
  }

  const safePrefixes = [
    "Ashby rejected ",
    "No Ashby jobs were returned.",
    "Unable to validate Ashby API key.",
  ];
  return safePrefixes.some((prefix) => error.startsWith(prefix)) ? error : fallback;
}

async function requestBody(request, readBody) {
  if (!readBody || !request) {
    return {};
  }

  return objectValue(await request.json().catch(() => ({})));
}

function responseJson(payload, status) {
  return Response.json(payload, { status });
}

async function proxyAshbyOnboarding(request, context, config) {
  const session = objectValue(context.session);
  const user = objectValue(session.user);
  const email = stringValue(user.email);

  if (!email) {
    return responseJson({ error: "Not signed in." }, 401);
  }

  if (!context.canViewDashboard(context.session)) {
    return responseJson({ error: ORG_REQUIRED_ERROR }, 403);
  }

  if (!context.canManageAshbyOnboarding(context.session)) {
    return responseJson({ error: context.adminDeniedError ?? ADMIN_DENIED_ERROR }, 403);
  }

  const body = await requestBody(request, config.readBody);
  const organizationId = stringValue(
    context.sessionOrganizationId
      ? context.sessionOrganizationId(context.session)
      : session.organizationId,
  );
  if (!organizationId) {
    return responseJson({ error: ORG_REQUIRED_ERROR }, 403);
  }

  const identity = context.companyIdentityFromUser({
    email,
    organizationId,
  });

  let response;
  try {
    response = await context.fetchImpl(`${context.backendBaseUrl()}${config.backendPath}`, {
      method: "POST",
      headers: context.backendHeaders(),
      body: JSON.stringify(config.backendBody({ body, identity, email, context })),
      cache: "no-store",
    });
  } catch {
    return responseJson({ error: BACKEND_UNREACHABLE_ERROR }, 502);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    context.logger?.warn?.(config.logMessage, {
      status: response.status,
      backendPath: config.backendPath,
    });
    return responseJson({ error: safeBackendError(payload, config.backendError) }, response.status);
  }

  const payload = await response.json().catch(() => ({}));
  return responseJson(payload, response.status);
}

export function handleAshbyApiKeyOnboarding(request, context) {
  return proxyAshbyOnboarding(request, context, {
    backendPath: "/integrations/ashby/onboarding/api-key",
    backendError: ONBOARDING_BACKEND_ERROR,
    logMessage: "Ashby onboarding backend rejected request",
    readBody: true,
    backendBody: ({ body, identity, email }) => ({
      ...identity,
      reviewerEmail: email,
      ashbyApiKey: stringValue(body.ashbyApiKey),
    }),
  });
}

export function handleAshbyJobsOnboarding(request, context) {
  return proxyAshbyOnboarding(request, context, {
    backendPath: "/integrations/ashby/onboarding/jobs",
    backendError: ONBOARDING_BACKEND_ERROR,
    logMessage: "Ashby onboarding backend rejected request",
    readBody: true,
    backendBody: ({ body, identity, email, context: requestContext }) => ({
      ...identity,
      reviewerEmail: email,
      selectedJobIds: Array.isArray(body.selectedJobIds)
        ? body.selectedJobIds.filter((jobId) => typeof jobId === "string")
        : [],
      publicBaseUrl: requestContext.publicBaseUrl,
    }),
  });
}

export function handleAshbySyncOnboarding(request, context) {
  return proxyAshbyOnboarding(request, context, {
    backendPath: "/integrations/ashby/sync-active-applications",
    backendError: SYNC_BACKEND_ERROR,
    logMessage: "Ashby sync backend rejected request",
    readBody: false,
    backendBody: ({ identity, email }) => ({
      ...identity,
      reviewerEmail: email,
    }),
  });
}
