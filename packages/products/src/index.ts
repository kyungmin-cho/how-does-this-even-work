import { parseProduct, type Product } from "@assembly/engine/schema";
import pcAtxData from "../data/pc_atx.json";
import distillSetupData from "../data/distill_setup.json";

/**
 * The engine schema has no field for source URLs, and zod strips unknown keys, so `source`
 * arrays live only in the raw JSON (on guides and on mistakes). They are read from there.
 */
interface RawSourced {
  id: string;
  source?: string[];
}
interface RawProduct {
  guides?: RawSourced[];
  assembly?: { id: string; mistakes?: RawSourced[] }[];
}

const RAW: unknown[] = [pcAtxData, distillSetupData];

/** Every product, validated with the engine's parseProduct (throws on bad data at import). */
export const products: Product[] = RAW.map((d) => parseProduct(d));

{
  const seen = new Set<string>();
  for (const p of products) {
    if (seen.has(p.id)) throw new Error(`duplicate product id "${p.id}"`);
    seen.add(p.id);
  }
}

export const productIds: string[] = products.map((p) => p.id);

export function getProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export interface ProductSources {
  /** guide id → source URLs */
  guides: Record<string, string[]>;
  /** "stepId/mistakeId" → source URLs */
  mistakes: Record<string, string[]>;
}

function collectSources(raw: RawProduct): ProductSources {
  const guides: Record<string, string[]> = {};
  const mistakes: Record<string, string[]> = {};
  for (const g of raw.guides ?? []) guides[g.id] = [...(g.source ?? [])];
  for (const s of raw.assembly ?? []) {
    for (const m of s.mistakes ?? []) mistakes[`${s.id}/${m.id}`] = [...(m.source ?? [])];
  }
  return { guides, mistakes };
}

const SOURCES = new Map(products.map((p, i) => [p.id, collectSources(RAW[i] as RawProduct)]));

/** Source URLs for a product's guides and mistakes (manufacturer pages from research doc 04). */
export function getSources(productId: string): ProductSources | undefined {
  return SOURCES.get(productId);
}
