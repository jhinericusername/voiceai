import type { Metadata, Viewport } from "next";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://usepuddle.com";
const title = "Puddle | AI voice interviews for structured hiring signal";
const description =
  "Run live AI voice interviews with candidate rooms, controlled interviewer prompts, transcripts, and review-ready assessments.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  icons: {
    icon: "/puddle-symbol-512-padded.png",
    apple: "/puddle-symbol-512-padded.png",
  },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "Puddle",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Puddle AI voice interviews",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  themeColor: "#eef7ff",
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
