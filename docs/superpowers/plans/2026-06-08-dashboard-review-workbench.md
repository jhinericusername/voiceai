# Dashboard Review Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a queue-first dashboard and interview review view using realistic Puddle interview-review dummy data.

**Architecture:** Keep the implementation inside the existing Next.js dashboard routes. Extend `demo-data.ts` with review packet helpers and richer interview review fields, then update dashboard sections and the interview route to render those helpers through the existing UI primitives.

**Tech Stack:** Next.js App Router, React Server Components, TypeScript, Tailwind CSS utility classes.

---

## File Structure

- Modify `platform/app/dashboard/demo-data.ts`: extend demo types, add media/transcript/review fields, and add queue helper functions.
- Modify `platform/app/dashboard/DashboardSections.tsx`: replace the generic candidate queue with an interview packet queue and add review-focused side panels.
- Modify `platform/app/dashboard/page.tsx`: compose the new dashboard layout.
- Modify `platform/app/dashboard/review-queue/page.tsx`: reuse the queue at full size.
- Modify `platform/app/dashboard/interviews/[sessionId]/page.tsx`: replace operational session detail with media/transcript/scorecard/recommendation review workspace.
- Modify `platform/app/dashboard/dashboard-ui.tsx`: add small reusable formatting helpers if needed.

## Task 1: Review Data Model

- [ ] Extend `DemoSession` with `media`, `reviewSummary`, `transcript`, and `markers` fields.
- [ ] Add a `getReviewPackets()` helper that returns review-ready and in-review sessions joined with candidate and role data.
- [ ] Keep existing candidate and role helpers intact so older routes continue to render.
- [ ] Run `corepack pnpm@9.12.0 --filter @puddle/platform lint` and fix type/lint failures related to the data model.

## Task 2: Dashboard Queue

- [ ] Update `WorkspaceMetricStrip` to compute review-specific metrics from `getDashboardStats()`.
- [ ] Update `NeedsReviewQueue` to render interview packet rows with an `Open review` link to `/dashboard/interviews/[sessionId]`.
- [ ] Add compact side panels for active interviews/finalizing packets and review activity.
- [ ] Run `corepack pnpm@9.12.0 --filter @puddle/platform lint`.

## Task 3: Interview Review View

- [ ] Replace the current session detail layout with review workspace sections: header, media, transcript, scorecard, recommendation, artifacts, and audit timeline.
- [ ] Use existing candidate scorecard and authenticity signals as the source for the rubric and risk panels.
- [ ] Render decision controls as non-submitting dummy UI because persistence is out of scope.
- [ ] Run `corepack pnpm@9.12.0 --filter @puddle/platform lint`.

## Task 4: Rendered QA

- [ ] Open `http://localhost:3000/dashboard` in the Browser plugin.
- [ ] Verify page identity, nonblank content, no framework overlay, console health, and screenshot evidence.
- [ ] Navigate to at least one interview review view.
- [ ] Verify desktop and mobile viewport layouts.
- [ ] Run `corepack pnpm@9.12.0 --filter @puddle/platform build` before final reporting.
