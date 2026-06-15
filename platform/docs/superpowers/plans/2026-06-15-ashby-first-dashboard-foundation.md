# Ashby-First Dashboard Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live dashboard Ashby-onboarding-first, remove dummy dashboard data from production routes, and establish the jobs/roles-first workspace foundation needed before historical Fireflies import is broadly visible.

**Architecture:** The root dashboard layout owns authorization and onboarding gating: WorkOS org membership remains authentication/authorization, while completed Ashby setup becomes the product readiness gate for operational dashboard routes. Dashboard pages render honest Ashby-first empty/foundation states from real company state instead of `demo-data`; historical interview detail remains available only after the same gate and hides raw internal identifiers.

**Tech Stack:** Next.js App Router, React/TypeScript, WorkOS AuthKit, existing Puddle dashboard components, Node source tests.

---

## File Structure

- Create `platform/tests/dashboard-foundation-source.test.mjs`: source-level regression tests for onboarding gating, no dummy-data imports, role-explicit review queue, and human-readable interview detail.
- Create `platform/app/dashboard/ashby-dashboard-state.ts`: server-safe helpers for deciding whether Ashby onboarding is complete and deriving display counts.
- Create `platform/app/dashboard/AshbySetupOnlyScreen.tsx`: setup-only shell shown by the root layout before Ashby onboarding is complete.
- Create `platform/app/dashboard/AshbyFirstDashboardSections.tsx`: small real/foundation dashboard sections for roles, candidates, review queue, and placeholder operational pages.
- Modify `platform/app/dashboard/layout.tsx`: fetch Ashby company state and gate the whole dashboard subtree behind onboarding.
- Modify `platform/app/dashboard/DashboardChrome.tsx`: remove fake active role selector and global demo creation actions; add Ashby-first left nav.
- Modify `platform/app/dashboard/page.tsx`: redirect completed dashboards to `/dashboard/roles`; onboarding UI moves to layout.
- Modify `platform/app/dashboard/roles/page.tsx`: render the roles-first Puddle interviewing pipeline foundation from real company state.
- Modify `platform/app/dashboard/candidates/page.tsx`: render candidate/application foundation state without demo snapshots.
- Modify `platform/app/dashboard/review-queue/page.tsx`: always render a role picker/foundation first; no cross-role pooled queue.
- Create `platform/app/dashboard/recordings/page.tsx`, `platform/app/dashboard/analytics/page.tsx`, `platform/app/dashboard/settings/page.tsx`: nav targets with honest empty states.
- Modify `platform/app/dashboard/interviews/[sessionId]/page.tsx`: remove demo fallback and raw IDs from the visible UI.
- Modify `platform/app/dashboard/AshbyOnboardingWizard.tsx`: add the Puddle mascot to setup and remove selected job IDs from visible labels.
- Modify `platform/tests/org-access-source.test.mjs`, `platform/tests/ashby-onboarding-source.test.mjs`, and `platform/tests/dashboard-scale.test.mjs`: update old assertions to the new onboarding-first behavior.

---

### Task 1: Add Dashboard Foundation Source Tests

**Files:**

- Create: `platform/tests/dashboard-foundation-source.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `platform/tests/dashboard-foundation-source.test.mjs` with this content:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const layoutSource = await source("../app/dashboard/layout.tsx");
const chromeSource = await source("../app/dashboard/DashboardChrome.tsx");
const overviewSource = await source("../app/dashboard/page.tsx");
const rolesSource = await source("../app/dashboard/roles/page.tsx");
const candidatesSource = await source("../app/dashboard/candidates/page.tsx");
const reviewQueueSource = await source("../app/dashboard/review-queue/page.tsx");
const interviewDetailSource = await source("../app/dashboard/interviews/[sessionId]/page.tsx");
const wizardSource = await source("../app/dashboard/AshbyOnboardingWizard.tsx");

test("dashboard layout gates operational routes behind completed Ashby onboarding", () => {
  assert.match(layoutSource, /requireDashboardUser/);
  assert.match(layoutSource, /companyIdentityFromUser/);
  assert.match(layoutSource, /getAshbyCompanyState/);
  assert.match(layoutSource, /isAshbyDashboardReady/);
  assert.match(layoutSource, /AshbySetupOnlyScreen/);
  assert.match(layoutSource, /if\s*\(!onboardingComplete\)/);
  assert.match(layoutSource, /return\s*\(\s*<AshbySetupOnlyScreen/);
  assert.match(layoutSource, /DashboardChrome/);
  assert.doesNotMatch(layoutSource, /demoRoles/);
  assert.doesNotMatch(layoutSource, /demo-data/);
  assert.doesNotMatch(layoutSource, /allowedAuthDomains/);
});

test("dashboard chrome uses Ashby-first navigation without fake role controls", () => {
  for (const label of ["Roles", "Candidates", "Review Queue", "Recordings", "Analytics", "Settings"]) {
    assert.match(chromeSource, new RegExp(label));
  }

  assert.match(chromeSource, /Search candidates/);
  assert.match(chromeSource, /Cmd\+K/);
  assert.doesNotMatch(chromeSource, /CreateInterviewCard/);
  assert.doesNotMatch(chromeSource, /CreateTeamInvitationCard/);
  assert.doesNotMatch(chromeSource, /Active role/);
  assert.doesNotMatch(chromeSource, /roles:/);
  assert.doesNotMatch(chromeSource, /demoRoles/);
});

test("dashboard default route redirects to roles after onboarding", () => {
  assert.match(overviewSource, /redirect\("\/dashboard\/roles"\)/);
  assert.doesNotMatch(overviewSource, /AshbyOnboardingWizard/);
  assert.doesNotMatch(overviewSource, /DashboardSections/);
  assert.doesNotMatch(overviewSource, /NeedsReviewQueue/);
  assert.doesNotMatch(overviewSource, /dashboardDemoFallbackEnabled/);
});

test("top-level operational pages do not import demo dashboard data", () => {
  for (const [name, pageSource] of [
    ["roles", rolesSource],
    ["candidates", candidatesSource],
    ["review queue", reviewQueueSource],
  ]) {
    assert.doesNotMatch(pageSource, /demo-data/, `${name} page should not import demo-data`);
    assert.doesNotMatch(pageSource, /DashboardSections/, `${name} page should not import demo dashboard sections`);
    assert.doesNotMatch(pageSource, /dashboardDemoFallbackEnabled/, `${name} page should not enable demo fallback`);
  }
});

test("roles, candidates, and review queue are explicit about role-scoped interviewing", () => {
  assert.match(rolesSource, /RolesPipelineFoundation/);
  assert.match(rolesSource, /selectedAshbyJobCount/);
  assert.match(candidatesSource, /CandidateApplicationsFoundation/);
  assert.match(reviewQueueSource, /ReviewRolePickerFoundation/);
  assert.match(reviewQueueSource, /role picker/i);
  assert.doesNotMatch(reviewQueueSource, /getRealInterviews/);
});

test("interview detail is real-only and hides raw internal identifiers", () => {
  assert.match(interviewDetailSource, /getRealInterview/);
  assert.match(interviewDetailSource, /Historical Fireflies import/);
  assert.match(interviewDetailSource, /Fireflies historical import/);
  assert.doesNotMatch(interviewDetailSource, /dashboardDemoFallbackEnabled/);
  assert.doesNotMatch(interviewDetailSource, /demoSessions/);
  assert.doesNotMatch(interviewDetailSource, /getSession\(/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Session"/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Transcript ID"/);
  assert.doesNotMatch(interviewDetailSource, /Org \{/);
  assert.doesNotMatch(interviewDetailSource, /script_version/);
  assert.doesNotMatch(interviewDetailSource, /storagePath/);
  assert.doesNotMatch(interviewDetailSource, /questionId/);
});

test("Ashby onboarding setup is friendly without exposing unreadable job identifiers", () => {
  assert.match(wizardSource, /puddle-mascot/);
  assert.doesNotMatch(wizardSource, /\$\{job\.status\} - \$\{job\.id\}/);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
cd platform
npm test -- dashboard-foundation-source.test.mjs
```

Expected: the new source test fails because `layout.tsx` does not gate the subtree, `DashboardChrome.tsx` still contains fake role/global action controls, and top-level pages still import demo sections.

- [ ] **Step 3: Commit the failing test**

```bash
git add platform/tests/dashboard-foundation-source.test.mjs
git commit -m "Add dashboard foundation source tests"
```

---

### Task 2: Gate Dashboard Routes Behind Ashby Onboarding

**Files:**

- Create: `platform/app/dashboard/ashby-dashboard-state.ts`
- Create: `platform/app/dashboard/AshbySetupOnlyScreen.tsx`
- Modify: `platform/app/dashboard/layout.tsx`

- [ ] **Step 1: Add server-safe Ashby dashboard state helpers**

Create `platform/app/dashboard/ashby-dashboard-state.ts`:

```ts
import type { AshbyCompanyState } from "@/lib/ashby/server";

export function isAshbyDashboardReady(state: AshbyCompanyState): boolean {
  return state.setupStatus === "connected" && state.connected && Boolean(state.lastSyncAt);
}

export function selectedAshbyJobCount(state: AshbyCompanyState): number {
  return state.selectedJobIds.length;
}
```

- [ ] **Step 2: Add the setup-only dashboard shell**

Create `platform/app/dashboard/AshbySetupOnlyScreen.tsx`:

```tsx
import Image from "next/image";
import type { AshbyCompanyState } from "@/lib/ashby/server";
import { AshbyOnboardingWizard } from "./AshbyOnboardingWizard";

export function AshbySetupOnlyScreen({
  state,
  canManageSetup,
}: {
  readonly state: AshbyCompanyState;
  readonly canManageSetup: boolean;
}) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex min-w-0 items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">
              Setup
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-950">Connect Ashby</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Finish Ashby setup before reviewing candidates, sending interviews, or opening imported recordings.
            </p>
          </div>
          <Image
            src="/puddle-mascot.svg"
            alt="Puddle turtle mascot"
            width={72}
            height={72}
            priority
            className="hidden h-16 w-16 shrink-0 sm:block"
          />
        </header>

        <AshbyOnboardingWizard state={state} canManageSetup={canManageSetup} />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Replace the root dashboard layout gate**

Replace `platform/app/dashboard/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { canManageAshbyOnboarding } from "@/lib/auth/ashby-onboarding-admin";
import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { noindexMetadata } from "@/lib/seo";
import { AshbySetupOnlyScreen } from "./AshbySetupOnlyScreen";
import { DashboardChrome } from "./DashboardChrome";
import { isAshbyDashboardReady } from "./ashby-dashboard-state";
import { requireDashboardUser } from "./auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = noindexMetadata;

export default async function DashboardLayout({ children }: { readonly children: ReactNode }) {
  const session = await requireDashboardUser();
  const { displayName, organizationId, user } = session;
  const identity = companyIdentityFromUser({ email: user.email, organizationId });
  const ashbyState = await getAshbyCompanyState(identity);
  const onboardingComplete = isAshbyDashboardReady(ashbyState);
  const canManageSetup = canManageAshbyOnboarding(session);

  if (!onboardingComplete) {
    return <AshbySetupOnlyScreen state={ashbyState} canManageSetup={canManageSetup} />;
  }

  return (
    <DashboardChrome displayName={displayName} email={user.email}>
      {children}
    </DashboardChrome>
  );
}
```

- [ ] **Step 4: Run the focused source test**

Run:

```bash
cd platform
npm test -- dashboard-foundation-source.test.mjs
```

Expected: the layout assertions pass; other assertions still fail until later tasks update chrome, pages, interview detail, and wizard.

- [ ] **Step 5: Commit**

```bash
git add platform/app/dashboard/ashby-dashboard-state.ts platform/app/dashboard/AshbySetupOnlyScreen.tsx platform/app/dashboard/layout.tsx
git commit -m "Gate dashboard behind Ashby onboarding"
```

---

### Task 3: Replace Demo Dashboard Chrome With Ashby-First Navigation

**Files:**

- Modify: `platform/app/dashboard/DashboardChrome.tsx`

- [ ] **Step 1: Remove fake global action imports and fake role props**

Update the top of `platform/app/dashboard/DashboardChrome.tsx` so it does not import `CreateInterviewCard`, `CreateTeamInvitationCard`, or receive `roles` / `allowedDomains` props. The prop type should be:

```tsx
export function DashboardChrome({
  children,
  displayName,
  email,
}: {
  readonly children: ReactNode;
  readonly displayName: string;
  readonly email: string;
}) {
```

- [ ] **Step 2: Replace navigation with the approved left-nav tabs**

Use this `navItems` array in `DashboardChrome.tsx`:

```tsx
const navItems = [
  { href: "/dashboard/roles", label: "Roles", icon: Briefcase },
  { href: "/dashboard/candidates", label: "Candidates", icon: Users },
  { href: "/dashboard/review-queue", label: "Review Queue", icon: ClipboardCheck },
  { href: "/dashboard/recordings", label: "Recordings", icon: Video },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;
```

Import the listed icons from `lucide-react`.

- [ ] **Step 3: Add the candidate/application search affordance**

In the chrome header, replace the active-role selector and create/invite buttons with a non-functional search affordance that makes the intended scope explicit:

```tsx
<button
  type="button"
  className="flex min-h-9 w-full max-w-md items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
>
  <span className="inline-flex min-w-0 items-center gap-2 truncate">
    <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
    <span className="truncate">Search candidates or applications</span>
  </span>
  <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
    Cmd+K
  </span>
</button>
```

- [ ] **Step 4: Keep the account affordance human-readable**

Keep the existing display name/email area, but do not show role IDs, job IDs, UUIDs, or fake active role labels.

- [ ] **Step 5: Run the focused source test**

Run:

```bash
cd platform
npm test -- dashboard-foundation-source.test.mjs
```

Expected: the chrome assertions pass; page/detail/wizard assertions still fail.

- [ ] **Step 6: Commit**

```bash
git add platform/app/dashboard/DashboardChrome.tsx
git commit -m "Use Ashby-first dashboard navigation"
```

---

### Task 4: Add Demo-Free Ashby-First Dashboard Sections

**Files:**

- Create: `platform/app/dashboard/AshbyFirstDashboardSections.tsx`

- [ ] **Step 1: Create real foundation sections**

Create `platform/app/dashboard/AshbyFirstDashboardSections.tsx`:

```tsx
import Link from "next/link";
import { ArrowRight, ClipboardCheck, Send, Video, Users } from "lucide-react";
import { EmptyState, formatDateTime, SectionPanel, StatusPill, secondaryButtonClass } from "./dashboard-ui";

export function SetupProgressSummary({
  selectedJobCount,
  lastSyncAt,
}: {
  readonly selectedJobCount: number;
  readonly lastSyncAt: string | null;
}) {
  return (
    <SectionPanel
      title="Ashby pipeline"
      eyebrow="Connected"
      action={<StatusPill status={lastSyncAt ? "Synced" : "Sync pending"} />}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-sm font-semibold text-slate-950">
            {selectedJobCount} selected {selectedJobCount === 1 ? "role" : "roles"}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Puddle uses selected Ashby roles to organize interview sending, scheduling, and review queues.
          </p>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-950">Last candidate sync</div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {lastSyncAt ? formatDateTime(lastSyncAt) : "Run the active candidate sync from Ashby setup."}
          </p>
        </div>
      </div>
    </SectionPanel>
  );
}

export function RolesPipelineFoundation({
  selectedJobCount,
  lastSyncAt,
}: {
  readonly selectedJobCount: number;
  readonly lastSyncAt: string | null;
}) {
  const states = [
    {
      title: "Send interviews",
      icon: Send,
      detail: "Applications from configured Ashby stages will appear here for bulk or single-candidate sending.",
    },
    {
      title: "Scheduled",
      icon: Video,
      detail:
        "Puddle marks interviews as sent or scheduled immediately. Calendar booking support should replace immediate scheduling when Cal integration ships.",
    },
    {
      title: "Needs review",
      icon: ClipboardCheck,
      detail: "Completed interviews are reviewed inside the role they belong to so the rubric stays job-specific.",
    },
  ] as const;

  return (
    <div className="space-y-4">
      <SetupProgressSummary selectedJobCount={selectedJobCount} lastSyncAt={lastSyncAt} />

      <SectionPanel title="Interviewing pipeline" eyebrow="Roles first">
        <div className="grid gap-3 lg:grid-cols-3">
          {states.map((state) => {
            const Icon = state.icon;
            return (
              <div key={state.title} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <Icon className="h-4 w-4 text-cyan-700" aria-hidden="true" />
                  {state.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{state.detail}</p>
              </div>
            );
          })}
        </div>
        {selectedJobCount === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Select Ashby roles to build the pipeline"
              detail="A workspace admin can return to Ashby setup and choose which roles Puddle should screen."
            />
          </div>
        ) : null}
      </SectionPanel>
    </div>
  );
}

export function CandidateApplicationsFoundation({
  lastSyncAt,
}: {
  readonly lastSyncAt: string | null;
}) {
  return (
    <SectionPanel
      title="Candidates"
      eyebrow="Applications"
      action={<StatusPill status={lastSyncAt ? "Synced from Ashby" : "Sync pending"} />}
    >
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm leading-6 text-slate-600">
            This page will show synced Ashby applications for the roles selected during onboarding.
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Global Cmd+K search is scoped to candidates and applications.
          </p>
        </div>
        <Link href="/dashboard/roles" className={secondaryButtonClass}>
          View roles
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </SectionPanel>
  );
}

export function ReviewRolePickerFoundation({
  selectedJobCount,
}: {
  readonly selectedJobCount: number;
}) {
  return (
    <SectionPanel
      title="Review Queue"
      eyebrow="Role required"
      action={<StatusPill status="Role picker required" />}
    >
      <div className="space-y-4">
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Choose a role before reviewing interviews. FDE, MLE, and GTM Engineer reviews stay separate because each
          role uses its own rubric and decision criteria.
        </p>
        {selectedJobCount > 0 ? (
          <button type="button" disabled className={secondaryButtonClass}>
            Role picker appears after role names sync
          </button>
        ) : (
          <EmptyState
            title="No selected Ashby roles yet"
            detail="Finish Ashby job selection before review queues are available."
          />
        )}
      </div>
    </SectionPanel>
  );
}

export function OperationalPlaceholderPage({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <SectionPanel title={title} eyebrow="Puddle">
      <div className="flex min-w-0 items-start gap-3">
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" aria-hidden="true" />
        <p className="text-sm leading-6 text-slate-600">{detail}</p>
      </div>
    </SectionPanel>
  );
}
```

- [ ] **Step 2: Run lint for this file**

Run:

```bash
cd platform
npm run lint
```

Expected: lint may still fail because later pages have not been updated, but this new file should not introduce syntax or import errors.

- [ ] **Step 3: Commit**

```bash
git add platform/app/dashboard/AshbyFirstDashboardSections.tsx
git commit -m "Add Ashby-first dashboard foundation sections"
```

---

### Task 5: Replace Top-Level Dashboard Pages With Real Foundation States

**Files:**

- Modify: `platform/app/dashboard/page.tsx`
- Modify: `platform/app/dashboard/roles/page.tsx`
- Modify: `platform/app/dashboard/candidates/page.tsx`
- Modify: `platform/app/dashboard/review-queue/page.tsx`
- Create: `platform/app/dashboard/recordings/page.tsx`
- Create: `platform/app/dashboard/analytics/page.tsx`
- Create: `platform/app/dashboard/settings/page.tsx`

- [ ] **Step 1: Make `/dashboard` redirect to roles**

Replace `platform/app/dashboard/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function DashboardHomePage() {
  redirect("/dashboard/roles");
}
```

- [ ] **Step 2: Render the roles-first pipeline foundation**

Replace `platform/app/dashboard/roles/page.tsx` with:

```tsx
import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { RolesPipelineFoundation } from "../AshbyFirstDashboardSections";
import { selectedAshbyJobCount } from "../ashby-dashboard-state";
import { requireDashboardUser } from "../auth";

export default async function RolesPage() {
  const session = await requireDashboardUser("/dashboard/roles");
  const state = await getAshbyCompanyState(
    companyIdentityFromUser({ email: session.user.email, organizationId: session.organizationId }),
  );

  return <RolesPipelineFoundation selectedJobCount={selectedAshbyJobCount(state)} lastSyncAt={state.lastSyncAt} />;
}
```

- [ ] **Step 3: Render the candidate/application foundation**

Replace `platform/app/dashboard/candidates/page.tsx` with:

```tsx
import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { CandidateApplicationsFoundation } from "../AshbyFirstDashboardSections";
import { requireDashboardUser } from "../auth";

export default async function CandidatesPage() {
  const session = await requireDashboardUser("/dashboard/candidates");
  const state = await getAshbyCompanyState(
    companyIdentityFromUser({ email: session.user.email, organizationId: session.organizationId }),
  );

  return <CandidateApplicationsFoundation lastSyncAt={state.lastSyncAt} />;
}
```

- [ ] **Step 4: Render the role-explicit review queue foundation**

Replace `platform/app/dashboard/review-queue/page.tsx` with:

```tsx
import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { ReviewRolePickerFoundation } from "../AshbyFirstDashboardSections";
import { selectedAshbyJobCount } from "../ashby-dashboard-state";
import { requireDashboardUser } from "../auth";

export default async function ReviewQueuePage() {
  const session = await requireDashboardUser("/dashboard/review-queue");
  const state = await getAshbyCompanyState(
    companyIdentityFromUser({ email: session.user.email, organizationId: session.organizationId }),
  );

  return <ReviewRolePickerFoundation selectedJobCount={selectedAshbyJobCount(state)} />;
}
```

- [ ] **Step 5: Add nav target pages**

Create `platform/app/dashboard/recordings/page.tsx`:

```tsx
import { OperationalPlaceholderPage } from "../AshbyFirstDashboardSections";

export default function RecordingsPage() {
  return (
    <OperationalPlaceholderPage
      title="Recordings"
      detail="Recordings will appear here after interviews are sent, scheduled, completed, and imported into the selected role pipeline."
    />
  );
}
```

Create `platform/app/dashboard/analytics/page.tsx`:

```tsx
import { OperationalPlaceholderPage } from "../AshbyFirstDashboardSections";

export default function AnalyticsPage() {
  return (
    <OperationalPlaceholderPage
      title="Analytics"
      detail="Analytics will summarize interview throughput and review outcomes once real Ashby applications and Puddle interview results are flowing."
    />
  );
}
```

Create `platform/app/dashboard/settings/page.tsx`:

```tsx
import { OperationalPlaceholderPage } from "../AshbyFirstDashboardSections";

export default function SettingsPage() {
  return (
    <OperationalPlaceholderPage
      title="Settings"
      detail="Settings will manage Puddle interview stages, email templates, and reviewer workflow for the connected Ashby workspace."
    />
  );
}
```

- [ ] **Step 6: Run the focused source test**

Run:

```bash
cd platform
npm test -- dashboard-foundation-source.test.mjs
```

Expected: top-level page assertions pass; interview detail and wizard assertions may still fail.

- [ ] **Step 7: Commit**

```bash
git add platform/app/dashboard/page.tsx platform/app/dashboard/roles/page.tsx platform/app/dashboard/candidates/page.tsx platform/app/dashboard/review-queue/page.tsx platform/app/dashboard/recordings/page.tsx platform/app/dashboard/analytics/page.tsx platform/app/dashboard/settings/page.tsx
git commit -m "Replace dashboard demos with Ashby-first foundation pages"
```

---

### Task 6: Remove Demo Fallback And Raw IDs From Interview Detail

**Files:**

- Modify: `platform/app/dashboard/interviews/[sessionId]/page.tsx`

- [ ] **Step 1: Remove demo imports and static demo params**

In `platform/app/dashboard/interviews/[sessionId]/page.tsx`, remove imports from `../../demo-data` and remove `dashboardDemoFallbackEnabled`. Replace `generateStaticParams()` with:

```tsx
export function generateStaticParams() {
  return [];
}
```

- [ ] **Step 2: Make the route real-only**

Replace the existing `InterviewDetailPage` data-loading fallback with:

```tsx
export default async function InterviewDetailPage({ params }: { readonly params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  let realInterview: RealInterviewDetail | null = null;

  try {
    realInterview = await getRealInterview(sessionId);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load real interview detail", error);
    }
  }

  if (!realInterview) {
    notFound();
  }

  return <RealInterviewDetailView realInterview={realInterview} />;
}
```

- [ ] **Step 3: Hide implementation identifiers in the visible UI**

Update `RealInterviewDetailView` so visible content uses human-readable fields only:

```tsx
const isHistoricalFireflies = realInterview.external_source === "fireflies";
const candidateLabel = realInterview.candidate_email ?? "Candidate";
const title = candidateLabel;
const completedAt = realInterview.started_at ?? realInterview.scheduled_at;
```

Remove visible rows or text that include:

```tsx
realInterview.session_id
realInterview.org_id
realInterview.script_version
realInterview.external_id
artifact.storagePath
turn.questionId
```

Keep these human-readable provenance rows:

```tsx
{isHistoricalFireflies ? <StatusPill status="Historical Fireflies import" /> : null}
{isHistoricalFireflies ? <PacketMetaRow label="Source" value="Fireflies historical import" /> : null}
```

- [ ] **Step 4: Keep playback and transcript behavior intact**

Keep:

```tsx
const videoArtifact = realInterview.artifacts.find((artifact) => artifact.kind === "composite_video");
const audioArtifact = realInterview.artifacts.find((artifact) => artifact.kind === "candidate_audio");
const playbackArtifact = videoArtifact ?? audioArtifact;
```

Keep signed artifact playback URLs through `artifact.mediaUrl`, transcript turns on the right side, and summary/review content below the media area.

- [ ] **Step 5: Run the focused source test**

Run:

```bash
cd platform
npm test -- dashboard-foundation-source.test.mjs
```

Expected: interview detail assertions pass; wizard assertion may still fail.

- [ ] **Step 6: Commit**

```bash
git add 'platform/app/dashboard/interviews/[sessionId]/page.tsx'
git commit -m "Show interview detail without raw identifiers"
```

---

### Task 7: Make Ashby Onboarding Friendly And Human-Readable

**Files:**

- Modify: `platform/app/dashboard/AshbyOnboardingWizard.tsx`

- [ ] **Step 1: Add mascot asset rendering**

Add this import near the top:

```tsx
import Image from "next/image";
```

Render the mascot in the primary setup panel header area:

```tsx
<Image
  src="/puddle-mascot.svg"
  alt="Puddle turtle mascot"
  width={56}
  height={56}
  className="hidden h-14 w-14 shrink-0 sm:block"
/>
```

- [ ] **Step 2: Remove raw selected job IDs from visible labels**

Replace selected job display text that combines status and ID:

```tsx
{job.status ? `${job.status} - ${job.id}` : job.id}
```

with:

```tsx
{job.status ? job.status : "Selected role"}
```

Keep `job.id` only in form values, React keys, and request payloads where it is required by Ashby.

- [ ] **Step 3: Run the focused source test**

Run:

```bash
cd platform
npm test -- dashboard-foundation-source.test.mjs
```

Expected: all tests in `dashboard-foundation-source.test.mjs` pass.

- [ ] **Step 4: Commit**

```bash
git add platform/app/dashboard/AshbyOnboardingWizard.tsx
git commit -m "Make Ashby onboarding setup friendlier"
```

---

### Task 8: Update Existing Source Tests For The New Gate

**Files:**

- Modify: `platform/tests/org-access-source.test.mjs`
- Modify: `platform/tests/ashby-onboarding-source.test.mjs`
- Modify: `platform/tests/dashboard-scale.test.mjs`

- [ ] **Step 1: Update org access test expectation**

In `platform/tests/org-access-source.test.mjs`, replace the old test named:

```js
test("dashboard layout does not block interview detail routes behind Ashby onboarding", () => {
```

with:

```js
test("dashboard layout gates interview detail routes behind completed Ashby onboarding", () => {
  assert.match(dashboardLayoutSource, /requireDashboardUser/);
  assert.match(dashboardLayoutSource, /DashboardChrome/);
  assert.match(dashboardLayoutSource, /AshbySetupOnlyScreen/);
  assert.match(dashboardLayoutSource, /companyIdentityFromUser/);
  assert.match(dashboardLayoutSource, /getAshbyCompanyState/);
  assert.match(dashboardLayoutSource, /if\s*\(!onboardingComplete\)/);
});
```

Also update the Fireflies provenance test to stop requiring a visible transcript ID:

```js
test("interview detail page displays Fireflies provenance without domain lookup access", () => {
  assert.match(interviewDetailPageSource, /Historical Fireflies import/);
  assert.match(interviewDetailPageSource, /Fireflies historical import/);
  assert.match(interviewDetailPageSource, /external_source\s*===\s*"fireflies"/);
  assert.doesNotMatch(interviewDetailPageSource, /Transcript ID/);
  assert.doesNotMatch(interviewDetailPageSource, /isAllowedAuthEmail/);
  assert.doesNotMatch(interviewDetailPageSource, /allowedAuthDomains/);
});
```

- [ ] **Step 2: Update Ashby onboarding test expectation**

In `platform/tests/ashby-onboarding-source.test.mjs`, replace the old test named:

```js
test("dashboard layout does not gate the entire dashboard subtree behind Ashby onboarding", () => {
```

with:

```js
test("dashboard layout gates the dashboard subtree behind Ashby onboarding", () => {
  assert.match(dashboardLayoutSource, /requireDashboardUser/);
  assert.match(dashboardLayoutSource, /companyIdentityFromUser/);
  assert.match(dashboardLayoutSource, /getAshbyCompanyState/);
  assert.match(dashboardLayoutSource, /AshbySetupOnlyScreen/);
  assert.match(dashboardLayoutSource, /if\s*\(!onboardingComplete\)/);

  const setupGateIndex = dashboardLayoutSource.indexOf("if (!onboardingComplete)");
  const dashboardChromeIndex = dashboardLayoutSource.indexOf("<DashboardChrome");

  assert.notEqual(setupGateIndex, -1);
  assert.notEqual(dashboardChromeIndex, -1);
  assert.ok(setupGateIndex < dashboardChromeIndex);
});
```

Replace the dashboard page onboarding test with:

```js
test("dashboard home redirects to roles because setup gating lives in layout", () => {
  assert.match(dashboardSource, /redirect\("\/dashboard\/roles"\)/);
  assert.match(dashboardLayoutSource, /AshbySetupOnlyScreen/);
  assert.match(wizardSource, /\/api\/ashby\/onboarding\/api-key/);
  assert.match(wizardSource, /\/api\/ashby\/onboarding\/jobs/);
  assert.match(wizardSource, /\/api\/ashby\/onboarding\/sync/);
  assert.match(wizardSource, /webhookSecret/);
  assert.match(wizardSource, /requiredEvents/);
  assert.match(wizardSource, /navigator\.clipboard\?\.writeText/);
  assert.match(wizardSource, /state\.setupStatus \?\? "job_selection_pending"/);
  assert.match(wizardSource, /setApiKey\(""\)/);
  assert.match(wizardSource, /visibleSelectedJobIds/);
  assert.match(wizardSource, /No Ashby jobs were returned/);
  assert.match(wizardSource, /const submittedApiKey = apiKey/);
  assert.match(wizardSource, /body: JSON\.stringify\(\{ ashbyApiKey: submittedApiKey \}\)/);
  assert.match(wizardSource, /useRouter/);
  assert.match(wizardSource, /router\.refresh\(\)/);
  assert.match(wizardSource, /hasVerifiedWebhook/);
  assert.match(wizardSource, /Check webhook connection/);
  assert.match(wizardSource, /Sync active candidates/);
  assert.match(wizardSource, /canManageSetup/);
  assert.match(wizardSource, /Ask a workspace admin or owner to finish Ashby setup\./);
  assert.doesNotMatch(wizardSource, /state\.setupStatus\.replaceAll/);
});
```

Replace the reconnect-path test with:

```js
test("dashboard layout keeps an admin reconnect path through the setup screen", () => {
  assert.match(dashboardLayoutSource, /canManageAshbyOnboarding/);
  assert.match(dashboardLayoutSource, /AshbySetupOnlyScreen state=\{ashbyState\} canManageSetup=\{canManageSetup\}/);
  assert.match(wizardSource, /Replace Ashby key|Reconnect Ashby/);
  assert.match(wizardSource, /Replacing the key resets webhook verification/);
});
```

- [ ] **Step 3: Update dashboard scale test expectation**

In `platform/tests/dashboard-scale.test.mjs`, replace the compact review queue test with:

```js
test("dashboard home redirects and operational pages stay compact", () => {
  assert.match(overviewSource, /redirect\("\/dashboard\/roles"\)/);
  assert.equal(dashboardSource.includes("min-w-[980px]"), false);
});
```

- [ ] **Step 4: Run platform source tests**

Run:

```bash
cd platform
npm test
```

Expected: all platform source tests pass.

- [ ] **Step 5: Commit**

```bash
git add platform/tests/org-access-source.test.mjs platform/tests/ashby-onboarding-source.test.mjs platform/tests/dashboard-scale.test.mjs
git commit -m "Update dashboard tests for Ashby-first gate"
```

---

### Task 9: Verify Build And Lint

**Files:**

- No source changes unless verification exposes a focused issue.

- [ ] **Step 1: Run platform lint**

Run:

```bash
cd platform
npm run lint
```

Expected: lint succeeds. If lint fails, fix only the reported dashboard files, then rerun `npm run lint`.

- [ ] **Step 2: Run platform build**

Run:

```bash
cd platform
npm run build
```

Expected: Next.js build succeeds.

- [ ] **Step 3: Run platform tests again**

Run:

```bash
cd platform
npm test
```

Expected: all platform source tests pass after lint/build fixes.

- [ ] **Step 4: Commit verification fixes if any**

If Step 1 or Step 2 required code changes, commit them:

```bash
git add platform
git commit -m "Verify Ashby-first dashboard foundation"
```

If no files changed, do not create an empty commit.

---

## Self-Review

- Spec coverage: this plan covers Ashby onboarding before dashboard access, separation of WorkOS authorization from product readiness, no dummy top-level dashboard data, jobs/roles-first layout, permanent role-explicit review queue, candidates nav and candidate/application search affordance, Puddle-owned workflow foundation, Fireflies-like review detail behavior, and no visible raw UUIDs or storage paths in interview detail.
- Historical import dependency: this plan intentionally does not run production historical import. It prepares the dashboard gate and visibility rules required before broad historical Fireflies rows are imported or surfaced.
- Open product gaps reserved for follow-up implementation: real Ashby role display names, stage mapping CRUD, email template composer, bulk send, single-candidate send icon, Ashby stage mutation, Cmd+K implementation, candidate list data, and role-specific review data. These need backend contracts beyond the foundation files touched here.
- Placeholder scan: the plan avoids generic implementation placeholders. Empty operational pages are explicit product foundation states, not fake data.
- Type consistency: `isAshbyDashboardReady`, `selectedAshbyJobCount`, `AshbySetupOnlyScreen`, `RolesPipelineFoundation`, `CandidateApplicationsFoundation`, `ReviewRolePickerFoundation`, and `OperationalPlaceholderPage` are consistently named across tasks.
