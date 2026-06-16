import Link from "next/link";

export interface PublicFooterLink {
  readonly label: string;
  readonly href: string;
}

const legalLinks: readonly PublicFooterLink[] = [
  { label: "Resources", href: "/resources" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "AI interview disclosure", href: "/ai-interview-disclosure" },
  { label: "Subprocessors", href: "/subprocessors" },
];

function FooterLink({ link }: { readonly link: PublicFooterLink }) {
  const className = "text-inherit transition hover:text-slate-950";

  if (link.href.startsWith("/")) {
    return (
      <Link href={link.href} className={className}>
        {link.label}
      </Link>
    );
  }

  return (
    <a href={link.href} className={className}>
      {link.label}
    </a>
  );
}

export function PublicFooter({
  className = "",
  extraLinks = [],
  padded = true,
}: {
  readonly className?: string;
  readonly extraLinks?: readonly PublicFooterLink[];
  readonly padded?: boolean;
}) {
  const paddingClassName = padded ? "px-5 pb-8 sm:px-6" : "";
  const links = [{ label: "Contact", href: "mailto:hello@usepuddle.com" }, ...extraLinks, ...legalLinks] as const;

  return (
    <footer
      className={`mx-auto flex w-full max-w-6xl flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between ${paddingClassName} ${className}`}
    >
      <span>{new Date().getFullYear()} Puddle. Technical hiring infrastructure.</span>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2">
        {links.map((link) => (
          <FooterLink key={`${link.href}-${link.label}`} link={link} />
        ))}
      </nav>
    </footer>
  );
}
