import type { Metadata } from "next";
import { marketingPages } from "../marketingPages";
import { PublicPageShell } from "../PublicPageShell";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Product | Puddle",
  description: marketingPages.product.description,
};

export default function ProductPage() {
  return <PublicPageShell page={marketingPages.product} />;
}
