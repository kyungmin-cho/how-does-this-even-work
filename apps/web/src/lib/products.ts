import type { Product } from "@assembly/engine/schema";
import { products } from "@assembly/products";

/**
 * Products the app can open, keyed by URL slug. The data lives in @assembly/products
 * (already validated there). A product's slug is its id, except for short aliases below.
 */
const ALIASES: Record<string, string> = { pc_atx: "pc" };

const BY_SLUG = new Map<string, Product>(products.map((p) => [ALIASES[p.id] ?? p.id, p]));

export const PRODUCT_SLUGS = [...BY_SLUG.keys()];
export const DEFAULT_PRODUCT_SLUG = PRODUCT_SLUGS[0];

export function getProduct(slug: string): Product | null {
  return BY_SLUG.get(slug) ?? null;
}

export function isProductSlug(slug: string): boolean {
  return BY_SLUG.has(slug);
}

export function slugOf(productId: string): string {
  return ALIASES[productId] ?? productId;
}

export function listProducts(): { slug: string; name: string }[] {
  return PRODUCT_SLUGS.map((slug) => ({ slug, name: BY_SLUG.get(slug)!.name }));
}
