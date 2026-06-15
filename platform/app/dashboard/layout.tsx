import type { Metadata } from "next";
import type { ReactNode } from "react";
import { allowedAuthDomains } from "@/lib/auth/allowed-domains";
import { noindexMetadata } from "@/lib/seo";
import { DashboardChrome } from "./DashboardChrome";
import { requireDashboardUser } from "./auth";
import { demoRoles } from "./demo-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = noindexMetadata;

export default async function DashboardLayout({ children }: { readonly children: ReactNode }) {
  const session = await requireDashboardUser();
  const { displayName, user } = session;

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
