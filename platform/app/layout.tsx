import type { Metadata, Viewport } from "next";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.usepuddle.com";
const title = "Puddle | Technical hiring infrastructure";
const description =
  "Turn engineering hiring into an evidence-backed system with role-specific rubrics, structured AI video screens, recordings, transcripts, and reviewer-ready evidence.";
const openGraphImage = "/opengraph-image.png";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Puddle",
  title,
  description,
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "Puddle",
    images: [
      {
        url: openGraphImage,
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
    images: [openGraphImage],
  },
};

export const viewport: Viewport = {
  themeColor: "#f8fafd",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body>
        <AuthKitProvider>{children}</AuthKitProvider>
      </body>
    </html>
  );
}
