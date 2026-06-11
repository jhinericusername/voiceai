const ADMIN_DENIED_ERROR = "Ashby onboarding setup requires a workspace admin or owner.";
const BACKEND_UNREACHABLE_ERROR = "Interview backend is not reachable.";
const ONBOARDING_BACKEND_ERROR = "Ashby onboarding request failed.";
const SYNC_BACKEND_ERROR = "Ashby sync request failed.";

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
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

  if (!context.isAllowedAuthEmail(email)) {
    return responseJson({ error: "Email domain is not allowed." }, 403);
  }

  if (!context.canManageAshbyOnboarding(context.session)) {
    return responseJson({ error: context.adminDeniedError ?? ADMIN_DENIED_ERROR }, 403);
  }

  const body = await requestBody(request, config.readBody);
  const identity = context.companyIdentityFromUser({
    email,
    organizationId: stringValue(session.organizationId) || null,
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

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    context.logger?.warn?.(config.logMessage, { status: response.status, payload });
    return responseJson({ error: config.backendError }, response.status);
  }

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
