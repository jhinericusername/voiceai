import "server-only";

import { canManageAshbyOnboardingAccess } from "./org-access.mjs";

export const ASHBY_ONBOARDING_ADMIN_DENIED_ERROR =
  "Ashby onboarding setup requires a workspace admin or owner.";

export function canManageAshbyOnboarding(session: unknown): boolean {
  return canManageAshbyOnboardingAccess(session);
}
