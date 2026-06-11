import type { MetadataRoute } from "next";
import { absoluteCanonicalUrl } from "@/lib/seo";
import { resourcePages } from "./resources/resources";
import { sitemapPublicRoutes } from "./publicRoutes";

const lastModified = new Date("2026-06-03T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...sitemapPublicRoutes.map((route) => ({
      url: absoluteCanonicalUrl(route.path),
      lastModified,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...resourcePages.map((resource) => ({
      url: absoluteCanonicalUrl(`/resources/${resource.slug}`),
      lastModified: new Date(resource.updatedAt ?? resource.publishedAt),
      changeFrequency: "monthly" as const,
      priority: 0.68,
    })),
  ];
}
