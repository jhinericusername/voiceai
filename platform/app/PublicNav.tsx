"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

const productLinks = [
  { label: "Overview", href: "/product", detail: "End-to-end AI engineer hiring workflow." },
  { label: "Rubric", href: "/product/rubric", detail: "Define the role-specific hiring bar." },
  { label: "AI recruiter", href: "/product/sourcing", detail: "Source and rank candidates beyond resumes." },
  { label: "Video interviews", href: "/product/video-interviews", detail: "Run fast 10-minute screens at scale." },
];

const trustLinks = [
  { label: "Overview", href: "/trust", detail: "How Puddle keeps hiring evidence inspectable." },
  { label: "Security", href: "/trust/security", detail: "Controls for sensitive recruiting data." },
  { label: "Privacy", href: "/privacy", detail: "Candidate recordings, retention, and deletion." },
  { label: "Subprocessors", href: "/subprocessors", detail: "Core service providers and data categories." },
  { label: "Responsible AI", href: "/trust/responsible-ai", detail: "Bounded agents, human review, and auditability." },
  { label: "Candidate experience", href: "/trust/candidate-experience", detail: "What candidates see before and during Puddle." },
];

const directLinks = [
  { label: "Sample Report", href: "/sample-report" },
  { label: "Candidates", href: "/candidates" },
  { label: "Resources", href: "/resources" },
];

interface PublicNavProps {
  readonly homeHref?: string;
}

export function PublicNav({ homeHref = "/" }: PublicNavProps) {
  const [open, setOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<"Product" | "Trust" | null>(null);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <nav aria-label="Global" className="fixed inset-x-0 top-0 z-50 w-screen bg-white/[0.94] backdrop-blur-xl">
      <div className="overflow-visible">
        <div className="flex items-center justify-between gap-4 px-5 py-3 sm:px-6 lg:px-8">
          <Link href={homeHref} className="flex min-w-0 flex-1 items-center gap-2" aria-label="Puddle home">
            <Image src="/puddle-symbol-black-nobg.png" alt="" width={38} height={38} className="h-9 w-9" priority />
            <span className="text-lg font-semibold text-slate-950">Puddle</span>
          </Link>

          <div className="hidden items-center gap-1 lg:flex">
            <NavMenu
              label="Product"
              links={productLinks}
              active={activeMenu === "Product"}
              onOpen={() => setActiveMenu("Product")}
              onClose={() => setActiveMenu(null)}
            />
            {directLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
              >
                {link.label}
              </Link>
            ))}
            <NavMenu
              label="Trust"
              links={trustLinks}
              align="right"
              active={activeMenu === "Trust"}
              onOpen={() => setActiveMenu("Trust")}
              onClose={() => setActiveMenu(null)}
            />
          </div>

          <div className="hidden flex-1 items-center justify-end gap-2 sm:flex">
            <Link
              href="/dashboard"
              className="rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
            >
              Sign in
            </Link>
            <a
              href="mailto:hello@usepuddle.com"
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold !text-white transition hover:bg-slate-800"
            >
              Book a pilot
            </a>
          </div>

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-950 lg:hidden"
          >
            <span className="grid gap-1">
              <span className={`block h-0.5 w-4 bg-current transition ${open ? "translate-y-1.5 rotate-45" : ""}`} />
              <span className={`block h-0.5 w-4 bg-current transition ${open ? "opacity-0" : ""}`} />
              <span className={`block h-0.5 w-4 bg-current transition ${open ? "-translate-y-1.5 -rotate-45" : ""}`} />
            </span>
          </button>
        </div>

        {open ? (
          <div className="max-h-[calc(100svh-4.5rem)] overflow-y-auto border-t border-slate-200 px-3 pb-3 pt-2 lg:hidden">
            <MobileGroup label="Product" links={productLinks} onClick={() => setOpen(false)} />
            {directLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {link.label}
              </Link>
            ))}
            <MobileGroup label="Trust" links={trustLinks} onClick={() => setOpen(false)} />
            <a
              href="mailto:hello@usepuddle.com"
              onClick={() => setOpen(false)}
              className="mt-2 block rounded-md bg-slate-950 px-3 py-3 text-center text-sm font-semibold !text-white"
            >
              Book a pilot
            </a>
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="mt-2 block rounded-md border border-slate-200 px-3 py-3 text-center text-sm font-semibold text-slate-700"
            >
              Sign in
            </Link>
          </div>
        ) : null}
      </div>
    </nav>
  );
}

function NavMenu({
  label,
  links,
  active,
  onOpen,
  onClose,
  align = "left",
}: {
  readonly label: string;
  readonly links: readonly { label: string; href: string; detail: string }[];
  readonly active: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly align?: "left" | "right";
}) {
  return (
    <div className="relative" onMouseEnter={onOpen} onMouseLeave={onClose}>
      <button
        type="button"
        aria-expanded={active}
        onClick={() => (active ? onClose() : onOpen())}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition ${
          active ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"
        }`}
      >
        <span>{label}</span>
        <span className={`text-[10px] leading-none transition-transform ${active ? "rotate-180" : ""}`}>▼</span>
      </button>
      {active ? (
        <div
          className={`absolute top-[calc(100%+20px)] z-50 w-[320px] ${
          align === "right" ? "right-0" : "left-0"
        }`}
        >
          <div aria-hidden="true" className="absolute inset-x-0 -top-5 h-5" />
          <div className="rounded-lg border border-slate-200 bg-white p-2 opacity-100 shadow-[0_24px_70px_rgba(15,23,42,0.16)] transition">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="block rounded-md px-3 py-2.5 transition hover:bg-slate-50">
                <span className="block text-sm font-semibold text-slate-950">{link.label}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">{link.detail}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MobileGroup({
  label,
  links,
  onClick,
}: {
  readonly label: string;
  readonly links: readonly { label: string; href: string; detail: string }[];
  readonly onClick: () => void;
}) {
  return (
    <div className="py-2">
      <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="grid gap-1">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={onClick}
            className="rounded-md px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
