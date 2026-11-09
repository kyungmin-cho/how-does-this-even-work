import sample from "@assembly/engine/fixtures/sample.json";
import { parseProduct, type Product } from "@assembly/engine/schema";

/**
 * Products the app can open, keyed by URL slug.
 * "pc" points at the engine's sample PC until the full PC data lands in @assembly/products.
 */
const SOURCES: Record<string, unknown> = {
  pc: sample,
};

export const PRODUCT_SLUGS = Object.keys(SOURCES);
export const DEFAULT_PRODUCT_SLUG = PRODUCT_SLUGS[0];

const cache = new Map<string, Product>();

export function getProduct(slug: string): Product | null {
  const source = SOURCES[slug];
  if (!source) return null;
  let product = cache.get(slug);
  if (!product) {
    product = parseProduct(source);
    cache.set(slug, product);
  }
  return product;
}

export function isProductSlug(slug: string): boolean {
  return slug in SOURCES;
}

export function listProducts(): { slug: string; name: string }[] {
  return PRODUCT_SLUGS.map((slug) => ({ slug, name: getProduct(slug)!.name }));
}
