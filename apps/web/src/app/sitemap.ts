import type { MetadataRoute } from "next";

import { PRODUCT_SLUGS } from "@/lib/products";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    ...PRODUCT_SLUGS.map((slug) => ({
      url: `${SITE_URL}/studio/${slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
