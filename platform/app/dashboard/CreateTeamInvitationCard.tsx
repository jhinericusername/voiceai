"use client";

import { useMemo, useState } from "react";
import { emailDomain, isAllowedEmailForDomains, normalizeEmail } from "@/lib/auth/email-domain";

interface CreateTeamInvitationCardProps {
  readonly allowedDomains: readonly string[];
}

interface TeamInvitationResponse {
  readonly invitationId: string;
  readonly email: string;
  readonly state: string;
  readonly expiresAt: string;
  readonly organizationId: string | null;
  readonly error?: string;
}

export function CreateTeamInvitationCard({ allowedDomains }: CreateTeamInvitationCardProps) {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<TeamInvitationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  const normalizedEmail = normalizeEmail(email);
  const domain = emailDomain(normalizedEmail);
  const allowedDomainsLabel = allowedDomains.join(", ");
  const domainError = useMemo(() => {
    if (!normalizedEmail) return null;
    if (!domain) return "Enter a valid email address.";
    if (!isAllowedEmailForDomains(normalizedEmail, allowedDomains)) {
      return `Use an approved domain: ${allowedDomainsLabel}.`;
    }
    return null;
  }, [allowedDomains, allowedDomainsLabel, domain, normalizedEmail]);

  const expiresLabel = result?.expiresAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(result.expiresAt))
    : null;

  async function sendInvitation(): Promise<void> {
    setError(null);
    setResult(null);

    if (domainError || !normalizedEmail) {
      setError(domainError ?? "Enter an email address.");
      return;
    }

    setIsInviting(true);

    try {
      const response = await fetch("/api/team-invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const payload = (await response.json()) as TeamInvitationResponse;

      if (!response.ok) {
        setError(payload.error ?? "Could not send the invitation.");
        return;
      }

      setResult(payload);
      setEmail("");
    } catch {
      setError("Could not reach the invitation API.");
    } finally {
      setIsInviting(false);
    }
  }

  return (
    <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Team access</div>
      <h2 className="mt-2 text-xl font-semibold text-slate-950">Invite teammate</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Sends a WorkOS account invitation. Public sign-up stays disabled, and the server only allows approved company
        domains.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Teammate email
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
              setResult(null);
            }}
            className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-950 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
            placeholder={`name@${allowedDomains[0] ?? "example.com"}`}
          />
        </label>

        <button
          type="button"
          onClick={sendInvitation}
          disabled={isInviting || !normalizedEmail || Boolean(domainError)}
          className="self-end rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold !text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isInviting ? "Sending..." : "Send invite"}
        </button>
      </div>

      {domainError ? <div className="mt-2 text-xs font-medium text-amber-700">{domainError}</div> : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="font-semibold text-emerald-950">Invitation sent to {result.email}</div>
          <div className="mt-1">
            State: {result.state}
            {expiresLabel ? ` · Expires ${expiresLabel}` : ""}
          </div>
        </div>
      ) : null}
    </section>
  );
}
