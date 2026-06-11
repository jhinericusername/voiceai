import type { MetadataRoute } from "next";
import { absoluteCanonicalUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "GPTBot",
        disallow: "/",
      },
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: absoluteCanonicalUrl("/sitemap.xml"),
  };
}
