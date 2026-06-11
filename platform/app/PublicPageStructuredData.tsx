import { breadcrumbJsonLd, softwareApplicationJsonLd, webPageJsonLd, type BreadcrumbItem } from "@/lib/seo";
import { JsonLd } from "./JsonLd";
import type { PublicRouteSeo } from "./publicRoutes";

export function PublicPageStructuredData({
  route,
  breadcrumbs,
  kind = "webPage",
  name,
}: {
  readonly route: PublicRouteSeo;
  readonly breadcrumbs: readonly BreadcrumbItem[];
  readonly kind?: "softwareApplication" | "webPage";
  readonly name?: string;
}) {
  const pageData =
    kind === "softwareApplication"
      ? softwareApplicationJsonLd({
          name: name ?? route.title.replace(" | Puddle", ""),
          description: route.description,
          path: route.path,
        })
      : webPageJsonLd({
          name: name ?? route.title,
          description: route.description,
          path: route.path,
        });

  return <JsonLd data={[pageData, breadcrumbJsonLd(breadcrumbs)]} />;
}
