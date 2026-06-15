# WorkOS Admin Tooling Context

This repo now has a small WorkOS admin helper at `scripts/workos/workos-admin.mjs`.
It is meant for local/staging operator workflows while we move platform access
from domain-based checks to WorkOS organization membership and permissions.

## Why This Exists

Our access model is:

```text
WorkOS organization membership = tenant boundary
WorkOS role/permission = action authorization
Email domain = login/input policy only
```

The WorkOS dashboard remains the source of truth, but a local CLI makes common
checks faster during development and rollout:

- list orgs and domains,
- list org members,
- list pending invitations,
- send org-specific invites,
- update a membership role,
- inspect permissions and roles,
- run a read-only doctor check for required Puddle setup.

## Files

```text
scripts/workos/workos-admin.mjs       WorkOS REST client and CLI
scripts/workos/workos-admin.test.mjs  Node test suite for request shapes and doctor behavior
docs/workos-admin-tooling.md          This context file
```

The tool uses Node's built-in `fetch` and plain WorkOS REST endpoints. It does
not add a package dependency.

## Environment

Required:

```sh
export WORKOS_API_KEY=sk_...
```

The CLI also auto-loads env files before requiring `WORKOS_API_KEY`, in this
order:

```text
platform/.env.local
platform/.env
.env.local
.env
```

Existing shell environment values win over file values, so an explicitly
exported `WORKOS_API_KEY` is never overwritten by a file.

Optional:

```sh
export WORKOS_API_BASE_URL=https://api.workos.com
export PUDDLE_WORKOS_EXPECTED_ORGS="Puddle:usepuddle.com,Weave:workweave.ai"
export PUDDLE_WORKOS_REQUIRED_PERMISSIONS="dashboard:view,ashby:onboarding:manage,team:invite"
```

`WORKOS_API_KEY` must stay server/local only. Never expose it to platform
browser code.

## Commands

Run commands from the repository root.

```sh
pnpm workos -- orgs
pnpm workos -- members --org org_...
pnpm workos -- invites --org org_...
pnpm workos -- invite --org org_... --email person@example.com --role member
pnpm workos -- set-role --membership om_... --role admin
pnpm workos -- set-role --org org_... --email person@example.com --role admin
pnpm workos -- permissions
pnpm workos -- roles
pnpm workos -- doctor
```

Every list-style command accepts `--json`.

Shortcut scripts:

```sh
pnpm workos:orgs
pnpm workos:permissions
pnpm workos:roles
pnpm workos:doctor
pnpm test:workos
```

## Doctor Check

`pnpm workos:doctor` is read-only. It checks:

- expected org names/domains when `PUDDLE_WORKOS_EXPECTED_ORGS` is set,
- required permissions,
- default role permission expectations:

```text
member:
  dashboard:view

admin:
  dashboard:view
  ashby:onboarding:manage
  team:invite
```

It cannot currently verify WorkOS dashboard-only Hosted UI settings such as
whether public Sign-up is disabled. Keep those as manual rollout checklist
items:

```text
Authentication -> Features -> Sign-up: Disabled
Authentication -> Features -> Invitations: Enabled
Organizations -> <org> -> Features -> Domain policy -> Automatic membership: Disabled
```

## API Endpoints Used

The CLI mirrors paths used by the installed WorkOS Node SDK:

```text
GET  /organizations
GET  /user_management/users
GET  /user_management/organization_memberships
PUT  /user_management/organization_memberships/:membership_id
GET  /user_management/invitations
POST /user_management/invitations
GET  /authorization/permissions
GET  /authorization/roles
```

For invitations, the CLI sends org-scoped invites:

```json
{
  "email": "person@example.com",
  "organization_id": "org_...",
  "role_slug": "member",
  "expires_in_days": 7
}
```

## Current Rollout Status

WorkOS setup completed manually:

```text
Puddle org exists
Weave org exists
Domains are attached
Automatic membership is disabled
Public Sign-up is disabled
Invitations are enabled
Permissions exist
Permissions are attached to roles
Each org has one setup/admin account
```

Remaining product code work:

```text
platform:
  require WorkOS organization membership for dashboard access
  require ashby:onboarding:manage for Ashby onboarding routes
  require team:invite for in-app team invitations
  show no-org/member/admin/setup-incomplete dashboard states

backend:
  require organizationId as the Ashby tenant key
  remove email-domain fallback for sensitive Ashby integration lookup
  keep email_domain only as display/backfill metadata
  retain internal bearer auth between platform and backend

tests:
  admin can connect Ashby
  member cannot connect Ashby
  same-domain non-member cannot access dashboard
  org member cannot see another org's data
  team invite requires team:invite and sends an org-specific WorkOS invite
```

Until the in-app team invitation route is patched, use either the WorkOS
dashboard or this CLI for real org-specific access invites.
