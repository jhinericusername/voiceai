"use client";

import { useMemo, useState } from "react";
import { emailDomain, isAllowedEmailForDomains, normalizeEmail } from "@/lib/auth/email-domain";

interface CreateTeamInvitationCardProps {
  readonly allowedDomains: readonly string[];
  readonly variant?: "card" | "plain";
}

interface TeamInvitationResponse {
  readonly invitationId: string;
  readonly email: string;
  readonly state: string;
  readonly expiresAt: string;
  readonly organizationId: string | null;
  readonly error?: string;
}

export function CreateTeamInvitationCard({ allowedDomains, variant = "card" }: CreateTeamInvitationCardProps) {
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
    <section className={variant === "card" ? "rounded-md border border-slate-200 bg-white p-2.5" : "bg-white"}>
      {variant === "card" ? (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700">Team access</div>
          <h2 className="mt-1 text-sm font-semibold text-slate-950">Invite teammate</h2>
        </>
      ) : null}

      <div className={variant === "card" ? "mt-3 grid gap-3" : "grid gap-3"}>
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
          Teammate email
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
              setResult(null);
            }}
            className="min-h-8 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
            placeholder={`name@${allowedDomains[0] ?? "example.com"}`}
          />
        </label>

        <button
          type="button"
          onClick={sendInvitation}
          disabled={isInviting || !normalizedEmail || Boolean(domainError)}
          className="inline-flex min-h-8 items-center justify-center rounded-md bg-slate-950 px-3 text-sm font-semibold !text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isInviting ? "Sending..." : "Send invite"}
        </button>
      </div>

      {domainError ? <div className="mt-2 text-xs font-medium text-amber-700">{domainError}</div> : null}

      {error ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
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
