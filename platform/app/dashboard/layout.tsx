import type { ReactNode } from "react";
import { allowedAuthDomains } from "@/lib/auth/allowed-domains";
import { DashboardChrome } from "./DashboardChrome";
import { requireDashboardUser } from "./auth";
import { demoRoles } from "./demo-data";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { readonly children: ReactNode }) {
  const { displayName, user } = await requireDashboardUser();

  return (
    <DashboardChrome
      displayName={displayName}
      email={user.email}
      allowedDomains={allowedAuthDomains()}
      roles={demoRoles.map((role) => ({ id: role.id, title: role.title, status: role.status }))}
    >
      {children}
    </DashboardChrome>
  );
}
