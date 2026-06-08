import { serializeJsonLd } from "@/lib/seo";

export function JsonLd({ data }: { readonly data: unknown | readonly unknown[] }) {
  const entries = Array.isArray(data) ? data : [data];

  return (
    <>
      {entries.map((entry, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(entry) }}
        />
      ))}
    </>
  );
}
