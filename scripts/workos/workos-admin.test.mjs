import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createWorkosAdminClient,
  loadEnvFile,
  loadWorkosEnv,
  parseCliArgs,
  runDoctor,
  runCli,
  serializeTable,
} from "./workos-admin.mjs";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("WorkOS admin client sends bearer-authenticated requests with query params", async () => {
  const calls = [];
  const client = createWorkosAdminClient({
    apiKey: "sk_test_local",
    baseUrl: "https://api.example.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        object: "list",
        data: [{ id: "org_1", name: "Weave", domains: [{ domain: "workweave.ai" }] }],
      });
    },
  });

  const organizations = await client.listOrganizations({ limit: 50 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/organizations?limit=50");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.authorization, "Bearer sk_test_local");
  assert.equal(organizations[0].name, "Weave");
});

test("WorkOS admin client serializes org invitations as org-scoped role invites", async () => {
  const calls = [];
  const client = createWorkosAdminClient({
    apiKey: "sk_test_local",
    baseUrl: "https://api.example.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        id: "inv_1",
        email: "teammate@workweave.ai",
        organization_id: "org_weave",
        state: "pending",
      });
    },
  });

  await client.sendInvitation({
    organizationId: "org_weave",
    email: "teammate@workweave.ai",
    roleSlug: "member",
    expiresInDays: 7,
    inviterUserId: "user_admin",
  });

  assert.equal(calls[0].url, "https://api.example.test/user_management/invitations");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    email: "teammate@workweave.ai",
    organization_id: "org_weave",
    role_slug: "member",
    expires_in_days: 7,
    inviter_user_id: "user_admin",
  });
});

test("WorkOS admin client updates membership role by membership id", async () => {
  const calls = [];
  const client = createWorkosAdminClient({
    apiKey: "sk_test_local",
    baseUrl: "https://api.example.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        id: "om_1",
        user_id: "user_1",
        organization_id: "org_weave",
        role: { slug: "admin" },
      });
    },
  });

  await client.updateMembershipRole({ membershipId: "om_1", roleSlug: "admin" });

  assert.equal(calls[0].url, "https://api.example.test/user_management/organization_memberships/om_1");
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].init.body), { role_slug: "admin" });
});

test("doctor reports required permission and role gaps without mutating WorkOS", async () => {
  const client = {
    async listOrganizations() {
      return [
        {
          id: "org_weave",
          name: "Weave",
          domains: [{ domain: "workweave.ai" }],
        },
      ];
    },
    async listPermissions() {
      return [{ slug: "dashboard:view" }, { slug: "team:invite" }];
    },
    async listEnvironmentRoles() {
      return [
        { slug: "member", permissions: [{ slug: "dashboard:view" }] },
        { slug: "admin", permissions: [{ slug: "dashboard:view" }, { slug: "team:invite" }] },
      ];
    },
  };

  const report = await runDoctor(client, {
    expectedOrgs: [{ name: "Weave", domain: "workweave.ai" }],
    requiredPermissions: ["dashboard:view", "ashby:onboarding:manage", "team:invite"],
    rolePermissions: {
      member: ["dashboard:view"],
      admin: ["dashboard:view", "ashby:onboarding:manage", "team:invite"],
    },
  });

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["missing-permission", "role-missing-permission"],
  );
});

test("parseCliArgs supports command flags and positional command", () => {
  assert.deepEqual(parseCliArgs(["members", "--org", "org_1", "--json"]), {
    command: "members",
    flags: { org: "org_1", json: true },
  });
  assert.deepEqual(parseCliArgs(["--", "help"]), {
    command: "help",
    flags: {},
  });
});

test("serializeTable produces stable compact output", () => {
  assert.equal(
    serializeTable([
      { id: "org_1", name: "Weave" },
      { id: "org_2", name: "Puddle" },
    ]),
    "id     name\norg_1  Weave\norg_2  Puddle",
  );
});

test("help command does not require WORKOS_API_KEY", async () => {
  const originalApiKey = process.env.WORKOS_API_KEY;
  const originalLog = console.log;
  const output = [];
  delete process.env.WORKOS_API_KEY;
  console.log = (message) => output.push(String(message));

  try {
    await runCli(["help"]);
  } finally {
    console.log = originalLog;
    if (originalApiKey === undefined) {
      delete process.env.WORKOS_API_KEY;
    } else {
      process.env.WORKOS_API_KEY = originalApiKey;
    }
  }

  assert.match(output.join("\n"), /Usage:/);
});

test("loadEnvFile parses simple env files without overriding existing values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "puddle-workos-env-"));
  const envPath = join(dir, ".env.local");
  await writeFile(
    envPath,
    [
      "# comment",
      "WORKOS_API_KEY=sk_test_file",
      "QUOTED_VALUE=\"quoted literal\"",
      "EXISTING=from-file",
      "EMPTY_VALUE=",
      "",
    ].join("\n"),
  );

  try {
    const env = { EXISTING: "from-env" };
    const loaded = await loadEnvFile(envPath, env);

    assert.equal(loaded, true);
    assert.equal(env.WORKOS_API_KEY, "sk_test_file");
    assert.equal(env.QUOTED_VALUE, "quoted literal");
    assert.equal(env.EXISTING, "from-env");
    assert.equal(env.EMPTY_VALUE, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadWorkosEnv loads platform env before root env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "puddle-workos-env-"));
  await writeFile(join(dir, ".env.local"), "WORKOS_API_KEY=sk_root\n");
  await writeFile(join(dir, ".env"), "WORKOS_API_KEY=sk_root_env\n");
  await writeFile(join(dir, "platform.env.local"), "WORKOS_API_KEY=sk_platform\n");

  try {
    const env = {};
    const loaded = await loadWorkosEnv({
      env,
      paths: [
        join(dir, "platform.env.local"),
        join(dir, "platform.env"),
        join(dir, ".env.local"),
        join(dir, ".env"),
      ],
    });

    assert.deepEqual(loaded, [join(dir, "platform.env.local"), join(dir, ".env.local"), join(dir, ".env")]);
    assert.equal(env.WORKOS_API_KEY, "sk_platform");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
