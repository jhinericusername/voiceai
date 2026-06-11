import type { Metadata } from "next";

export const CANONICAL_ORIGIN = "https://app.usepuddle.com";
export const SITE_NAME = "Puddle";
export const DEFAULT_TITLE = "Puddle | Technical hiring infrastructure";
export const DEFAULT_DESCRIPTION =
  "Turn engineering hiring into an evidence-backed system with role-specific rubrics, structured AI video screens, recordings, transcripts, and reviewer-ready evidence.";
export const DEFAULT_OG_IMAGE = "/opengraph-image.png";

export interface PublicMetadataInput {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly image?: string;
}

export interface BreadcrumbItem {
  readonly name: string;
  readonly path: string;
}

export function absoluteCanonicalUrl(path: string): string {
  return new URL(path, `${CANONICAL_ORIGIN}/`).toString();
}

export function publicPageMetadata({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
}: PublicMetadataInput): Metadata {
  const url = absoluteCanonicalUrl(path);
  const imageUrl = absoluteCanonicalUrl(image);

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: "Puddle technical hiring infrastructure",
        },
      ],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export const noindexMetadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: CANONICAL_ORIGIN,
    logo: absoluteCanonicalUrl("/puddle-symbol-512-padded.png"),
    email: "hello@usepuddle.com",
    description: DEFAULT_DESCRIPTION,
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: CANONICAL_ORIGIN,
    description: DEFAULT_DESCRIPTION,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
    },
  };
}

export function softwareApplicationJsonLd({
  name,
  description,
  path,
}: {
  readonly name: string;
  readonly description: string;
  readonly path: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: absoluteCanonicalUrl(path),
    description,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: CANONICAL_ORIGIN,
    },
    offers: {
      "@type": "Offer",
      category: "Pilot",
      availability: "https://schema.org/InStock",
      url: absoluteCanonicalUrl(path),
    },
  };
}

export function breadcrumbJsonLd(items: readonly BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteCanonicalUrl(item.path),
    })),
  };
}

export function webPageJsonLd({
  name,
  description,
  path,
}: {
  readonly name: string;
  readonly description: string;
  readonly path: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    description,
    url: absoluteCanonicalUrl(path),
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: CANONICAL_ORIGIN,
    },
  };
}

export function articleJsonLd({
  title,
  description,
  path,
  datePublished,
  dateModified,
  authorName,
}: {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly datePublished: string;
  readonly dateModified?: string;
  readonly authorName: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    url: absoluteCanonicalUrl(path),
    datePublished,
    dateModified: dateModified ?? datePublished,
    author: {
      "@type": "Organization",
      name: authorName,
      url: CANONICAL_ORIGIN,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: absoluteCanonicalUrl("/puddle-symbol-512-padded.png"),
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": absoluteCanonicalUrl(path),
    },
  };
}
