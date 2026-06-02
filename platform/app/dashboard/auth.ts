import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { isAllowedAuthEmail } from "@/lib/auth/allowed-domains";

export async function requireDashboardUser(returnTo = "/dashboard") {
  const session = await withAuth();

  if (!session.user) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (!isAllowedAuthEmail(session.user.email)) {
    redirect("/not-authorized");
  }

  const displayName =
    [session.user.firstName, session.user.lastName].filter(Boolean).join(" ") || session.user.email;

  return {
    ...session,
    user: session.user,
    displayName,
  };
}
