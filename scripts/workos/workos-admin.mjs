#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_API_BASE_URL = "https://api.workos.com";
const DEFAULT_REQUIRED_PERMISSIONS = [
  "dashboard:view",
  "ashby:onboarding:manage",
  "team:invite",
];
const DEFAULT_ROLE_PERMISSIONS = {
  member: ["dashboard:view"],
  admin: ["dashboard:view", "ashby:onboarding:manage", "team:invite"],
};

function definedEntries(input) {
  return Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "");
}

function buildUrl(baseUrl, path, query = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of definedEntries(query)) {
    if (Array.isArray(value)) {
      url.searchParams.set(key, value.join(","));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function readPayload(response) {
  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    return text ? { error: text } : {};
  });
  return payload;
}

function listData(payload) {
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) {
    return payload.data;
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  return [];
}

function rolePermissionSlugs(role) {
  const permissions = Array.isArray(role?.permissions) ? role.permissions : [];
  return permissions
    .map((permission) => {
      if (typeof permission === "string") return permission;
      if (permission && typeof permission === "object" && typeof permission.slug === "string") {
        return permission.slug;
      }
      return "";
    })
    .filter(Boolean);
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const equalsIndex = withoutExport.indexOf("=");
  if (equalsIndex === -1) {
    return null;
  }
  const key = withoutExport.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }
  let value = withoutExport.slice(equalsIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

export async function loadEnvFile(path, env = process.env) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }
    if (env[parsed.key] === undefined) {
      env[parsed.key] = parsed.value;
    }
  }
  return true;
}

export async function loadWorkosEnv({
  env = process.env,
  cwd = process.cwd(),
  paths = [
    join(cwd, "platform", ".env.local"),
    join(cwd, "platform", ".env"),
    join(cwd, ".env.local"),
    join(cwd, ".env"),
  ],
} = {}) {
  const loaded = [];
  for (const path of paths) {
    if (await loadEnvFile(path, env)) {
      loaded.push(path);
    }
  }
  return loaded;
}

export function createWorkosAdminClient({
  apiKey = process.env.WORKOS_API_KEY,
  baseUrl = process.env.WORKOS_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) {
    throw new Error("WORKOS_API_KEY is required.");
  }
  if (!fetchImpl) {
    throw new Error("fetch is not available in this Node runtime.");
  }

  async function request(method, path, { query, body } = {}) {
    const init = {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "user-agent": "puddle-workos-admin/0.1",
      },
    };
    if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetchImpl(buildUrl(baseUrl, path, query), init);
    const payload = await readPayload(response);
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && typeof payload.message === "string"
          ? payload.message
          : `WorkOS API request failed with ${response.status}.`;
      throw new Error(message);
    }
    return payload;
  }

  return {
    request,
    async listOrganizations(options = {}) {
      return listData(
        await request("GET", "/organizations", {
          query: {
            limit: options.limit,
            before: options.before,
            after: options.after,
            order: options.order,
          },
        }),
      );
    },
    async listUsers(options = {}) {
      return listData(
        await request("GET", "/user_management/users", {
          query: {
            email: options.email,
            organization_id: options.organizationId,
            limit: options.limit,
            before: options.before,
            after: options.after,
            order: options.order,
          },
        }),
      );
    },
    async listOrganizationMemberships(options = {}) {
      return listData(
        await request("GET", "/user_management/organization_memberships", {
          query: {
            user_id: options.userId,
            organization_id: options.organizationId,
            statuses: Array.isArray(options.statuses) ? options.statuses.join(",") : options.statuses,
            limit: options.limit,
            before: options.before,
            after: options.after,
            order: options.order,
          },
        }),
      );
    },
    async listInvitations(options = {}) {
      return listData(
        await request("GET", "/user_management/invitations", {
          query: {
            email: options.email,
            organization_id: options.organizationId,
            limit: options.limit,
            before: options.before,
            after: options.after,
            order: options.order,
          },
        }),
      );
    },
    async sendInvitation(options) {
      return request("POST", "/user_management/invitations", {
        body: {
          email: normalizeEmail(options.email),
          organization_id: options.organizationId,
          expires_in_days: options.expiresInDays,
          inviter_user_id: options.inviterUserId,
          role_slug: options.roleSlug,
        },
      });
    },
    async updateMembershipRole(options) {
      return request("PUT", `/user_management/organization_memberships/${options.membershipId}`, {
        body: {
          role_slug: options.roleSlug,
          role_slugs: options.roleSlugs,
        },
      });
    },
    async listPermissions(options = {}) {
      return listData(
        await request("GET", "/authorization/permissions", {
          query: {
            limit: options.limit,
            before: options.before,
            after: options.after,
            order: options.order,
          },
        }),
      );
    },
    async listEnvironmentRoles() {
      const payload = await request("GET", "/authorization/roles");
      return listData(payload);
    },
  };
}

export function parseCliArgs(argv) {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const [command = "help", ...rest] = normalizedArgv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { command, flags };
}

export function serializeTable(rows) {
  if (!rows.length) {
    return "";
  }
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)),
  );
  const renderRow = (row) =>
    columns
      .map((column, index) => String(row[column] ?? "").padEnd(widths[index]))
      .join("  ")
      .trimEnd();
  return [renderRow(Object.fromEntries(columns.map((column) => [column, column]))), ...rows.map(renderRow)].join(
    "\n",
  );
}

function printRows(rows, flags) {
  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(serializeTable(rows));
}

function requiredFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${name} is required.`);
  }
  return value.trim();
}

function numberFlag(flags, name, fallback) {
  const raw = flags[name];
  if (raw === undefined || raw === true) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function domainList(organization) {
  return Array.isArray(organization.domains)
    ? organization.domains.map((domain) => domain.domain ?? domain).filter(Boolean).join(",")
    : "";
}

async function findMembershipByOrgAndEmail(client, organizationId, email) {
  const normalized = normalizeEmail(email);
  const users = await client.listUsers({ organizationId, email: normalized, limit: 10 });
  const user = users.find((candidate) => normalizeEmail(candidate.email) === normalized);
  if (!user) {
    throw new Error(`No WorkOS user found for ${normalized} in ${organizationId}.`);
  }
  const memberships = await client.listOrganizationMemberships({
    organizationId,
    userId: user.id,
    statuses: ["active", "pending", "inactive"],
    limit: 10,
  });
  const membership = memberships.find((candidate) => candidate.organization_id === organizationId);
  if (!membership) {
    throw new Error(`No membership found for ${normalized} in ${organizationId}.`);
  }
  return membership;
}

function parseExpectedOrgs(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((entry) => {
      const [name, domain] = entry.split(":").map((part) => part?.trim()).filter(Boolean);
      return name && domain ? { name, domain } : null;
    })
    .filter(Boolean);
}

function parseCsv(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultDoctorConfig(env = process.env) {
  return {
    expectedOrgs: parseExpectedOrgs(env.PUDDLE_WORKOS_EXPECTED_ORGS),
    requiredPermissions: parseCsv(env.PUDDLE_WORKOS_REQUIRED_PERMISSIONS, DEFAULT_REQUIRED_PERMISSIONS),
    rolePermissions: DEFAULT_ROLE_PERMISSIONS,
  };
}

export async function runDoctor(client, config = defaultDoctorConfig()) {
  const [organizations, permissions, roles] = await Promise.all([
    client.listOrganizations({ limit: 100 }),
    client.listPermissions({ limit: 100 }),
    client.listEnvironmentRoles(),
  ]);
  const findings = [];
  const permissionSlugs = new Set(permissions.map((permission) => permission.slug).filter(Boolean));
  const roleBySlug = new Map(roles.map((role) => [role.slug, role]));

  for (const expectedOrg of config.expectedOrgs ?? []) {
    const org = organizations.find((organization) => organization.name === expectedOrg.name);
    if (!org) {
      findings.push({
        code: "missing-org",
        message: `Missing WorkOS organization named ${expectedOrg.name}.`,
      });
      continue;
    }
    const domains = new Set(
      (org.domains ?? []).map((domain) => String(domain.domain ?? domain).toLowerCase()),
    );
    if (!domains.has(expectedOrg.domain.toLowerCase())) {
      findings.push({
        code: "missing-org-domain",
        message: `${expectedOrg.name} is missing domain ${expectedOrg.domain}.`,
      });
    }
  }

  for (const permissionSlug of config.requiredPermissions ?? []) {
    if (!permissionSlugs.has(permissionSlug)) {
      findings.push({
        code: "missing-permission",
        message: `Missing permission ${permissionSlug}.`,
      });
    }
  }

  for (const [roleSlug, requiredPermissions] of Object.entries(config.rolePermissions ?? {})) {
    const role = roleBySlug.get(roleSlug);
    if (!role) {
      findings.push({
        code: "missing-role",
        message: `Missing environment role ${roleSlug}.`,
      });
      continue;
    }
    const actualPermissions = new Set(rolePermissionSlugs(role));
    for (const permissionSlug of requiredPermissions) {
      if (!actualPermissions.has(permissionSlug)) {
        findings.push({
          code: "role-missing-permission",
          message: `Role ${roleSlug} is missing permission ${permissionSlug}.`,
        });
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    counts: {
      organizations: organizations.length,
      permissions: permissions.length,
      roles: roles.length,
    },
  };
}

function helpText() {
  return `Usage:
  pnpm workos -- orgs [--json]
  pnpm workos -- members --org <org_id> [--json]
  pnpm workos -- invites --org <org_id> [--json]
  pnpm workos -- invite --org <org_id> --email <email> [--role member] [--expires-days 7] [--inviter-user-id <user_id>]
  pnpm workos -- set-role --membership <membership_id> --role <role_slug>
  pnpm workos -- set-role --org <org_id> --email <email> --role <role_slug>
  pnpm workos -- permissions [--json]
  pnpm workos -- roles [--json]
  pnpm workos -- doctor [--json]

Environment:
  WORKOS_API_KEY                 Required API key.
  WORKOS_API_BASE_URL            Optional; defaults to ${DEFAULT_API_BASE_URL}.
  PUDDLE_WORKOS_EXPECTED_ORGS    Optional, e.g. "Puddle:usepuddle.com,Weave:workweave.ai".
`;
}

async function runCli(argv, client) {
  const { command, flags } = parseCliArgs(argv);

  if (command === "help" || flags.help) {
    console.log(helpText());
    return;
  }

  if (!client) {
    await loadWorkosEnv();
  }
  const workosClient = client ?? createWorkosAdminClient();

  if (command === "orgs") {
    const organizations = await workosClient.listOrganizations({ limit: numberFlag(flags, "limit", 100) });
    printRows(
      organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        domains: domainList(organization),
      })),
      flags,
    );
    return;
  }

  if (command === "members") {
    const organizationId = requiredFlag(flags, "org");
    const [memberships, users] = await Promise.all([
      workosClient.listOrganizationMemberships({
        organizationId,
        statuses: ["active", "pending", "inactive"],
        limit: numberFlag(flags, "limit", 100),
      }),
      workosClient.listUsers({ organizationId, limit: numberFlag(flags, "limit", 100) }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    printRows(
      memberships.map((membership) => {
        const user = userById.get(membership.user_id);
        return {
          membership: membership.id,
          user: membership.user_id,
          email: user?.email ?? "",
          status: membership.status,
          role: membership.role?.slug ?? membership.role ?? "",
        };
      }),
      flags,
    );
    return;
  }

  if (command === "invites") {
    const organizationId = requiredFlag(flags, "org");
    const invitations = await workosClient.listInvitations({
      organizationId,
      limit: numberFlag(flags, "limit", 100),
    });
    printRows(
      invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        state: invitation.state,
        org: invitation.organization_id ?? invitation.organizationId ?? "",
        expires: invitation.expires_at ?? invitation.expiresAt ?? "",
      })),
      flags,
    );
    return;
  }

  if (command === "invite") {
    const invitation = await workosClient.sendInvitation({
      organizationId: requiredFlag(flags, "org"),
      email: requiredFlag(flags, "email"),
      roleSlug: typeof flags.role === "string" ? flags.role : "member",
      expiresInDays: numberFlag(flags, "expires-days", 7),
      inviterUserId: typeof flags["inviter-user-id"] === "string" ? flags["inviter-user-id"] : undefined,
    });
    printRows(
      [
        {
          id: invitation.id,
          email: invitation.email,
          state: invitation.state,
          org: invitation.organization_id ?? invitation.organizationId ?? "",
        },
      ],
      flags,
    );
    return;
  }

  if (command === "set-role") {
    const roleSlug = requiredFlag(flags, "role");
    const membershipId =
      typeof flags.membership === "string"
        ? flags.membership
        : (
            await findMembershipByOrgAndEmail(
              workosClient,
              requiredFlag(flags, "org"),
              requiredFlag(flags, "email"),
            )
          ).id;
    const membership = await workosClient.updateMembershipRole({ membershipId, roleSlug });
    printRows(
      [
        {
          membership: membership.id,
          user: membership.user_id,
          org: membership.organization_id,
          role: membership.role?.slug ?? membership.role ?? roleSlug,
        },
      ],
      flags,
    );
    return;
  }

  if (command === "permissions") {
    const permissions = await workosClient.listPermissions({ limit: numberFlag(flags, "limit", 100) });
    printRows(
      permissions.map((permission) => ({
        slug: permission.slug,
        name: permission.name ?? "",
        description: permission.description ?? "",
      })),
      flags,
    );
    return;
  }

  if (command === "roles") {
    const roles = await workosClient.listEnvironmentRoles();
    printRows(
      roles.map((role) => ({
        slug: role.slug,
        name: role.name ?? "",
        permissions: rolePermissionSlugs(role).join(","),
      })),
      flags,
    );
    return;
  }

  if (command === "doctor") {
    const report = await runDoctor(workosClient);
    if (flags.json) {
      console.log(JSON.stringify(report, null, 2));
    } else if (report.ok) {
      console.log(`WorkOS doctor passed: ${JSON.stringify(report.counts)}`);
    } else {
      console.log("WorkOS doctor found issues:");
      console.log(serializeTable(report.findings));
    }
    if (!report.ok) {
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`Unknown WorkOS command: ${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { runCli };
