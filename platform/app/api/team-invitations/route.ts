import { NextResponse } from "next/server";
import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { allowedAuthDomainsLabel, isAllowedAuthEmail } from "@/lib/auth/allowed-domains";
import { emailDomain, normalizeEmail } from "@/lib/auth/email-domain";
import { canInviteTeam, sessionOrganizationId } from "@/lib/auth/org-access.mjs";

export const dynamic = "force-dynamic";

interface TeamInvitationResponse {
  readonly invitationId: string;
  readonly email: string;
  readonly state: string;
  readonly expiresAt: string;
  readonly organizationId: string | null;
}

function emailFromBody(body: unknown): string {
  if (!body || typeof body !== "object" || !("email" in body)) {
    return "";
  }

  return normalizeEmail(String(body.email ?? ""));
}

function invitationExpiryDays(): number {
  const configured = Number(process.env.PUDDLE_TEAM_INVITE_EXPIRY_DAYS ?? "7");
  return Number.isFinite(configured) && configured > 0 ? Math.min(Math.trunc(configured), 30) : 7;
}

function workosErrorStatus(error: unknown): number {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return error.status;
  }

  return 502;
}

function workosErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "WorkOS could not send the invitation.";
}

export async function POST(request: Request) {
  const session = await withAuth();
  const { user } = session;
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const organizationId = sessionOrganizationId(session);
  if (!organizationId) {
    return NextResponse.json({ error: "You need an invitation to access this workspace." }, { status: 403 });
  }

  if (!canInviteTeam(session)) {
    return NextResponse.json({ error: "Team invitations require workspace admin permission." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const email = emailFromBody(body);
  if (!emailDomain(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (!isAllowedAuthEmail(email)) {
    return NextResponse.json(
      { error: `Team invitations are limited to ${allowedAuthDomainsLabel()}.` },
      { status: 403 },
    );
  }

  try {
    const invitation = await getWorkOS().userManagement.sendInvitation({
      email,
      expiresInDays: invitationExpiryDays(),
      inviterUserId: user.id,
      organizationId,
    });

    const response: TeamInvitationResponse = {
      invitationId: invitation.id,
      email: invitation.email,
      state: invitation.state,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Failed to send WorkOS team invitation", {
      status: workosErrorStatus(error),
      message: workosErrorMessage(error),
    });

    return NextResponse.json({ error: workosErrorMessage(error) }, { status: workosErrorStatus(error) });
  }
}
