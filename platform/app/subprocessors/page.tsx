import type { Metadata } from "next";
import { LegalPageShell } from "../LegalPageShell";
import { subprocessorsPage } from "../legalPages";
import { publicRouteSeo } from "../publicRoutes";
import { PublicPageStructuredData } from "../PublicPageStructuredData";
import { publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.subprocessors;

export const metadata: Metadata = publicPageMetadata(route);

export default function SubprocessorsPage() {
  return (
    <>
      <PublicPageStructuredData
        route={route}
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Subprocessors", path: "/subprocessors" },
        ]}
      />
      <LegalPageShell page={subprocessorsPage} />
    </>
  );
}
