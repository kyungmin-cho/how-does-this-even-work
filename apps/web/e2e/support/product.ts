import { readFileSync } from "node:fs";

/** The PC product data the studio opens at /studio/pc, read raw so tests follow data changes. */
interface RawProduct {
  id: string;
  name: string;
  parts: { id: string; label: string; consumable?: boolean }[];
  features: { id: string; partId: string; label: string }[];
  assembly: { id: string; partId: string; label: string; mistakes?: { id: string; label: string }[] }[];
  guides: { id: string; title: string; symptoms: string[]; targetPartId: string }[];
  views: Record<string, { label?: string }>;
}

export const pc: RawProduct = JSON.parse(
  readFileSync(require.resolve("@assembly/products/data/pc_atx.json"), "utf8"),
);

export const partLabel = (id: string) => pc.parts.find((p) => p.id === id)!.label;
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "n/total" text of the step bar for assembly step index i (0-based). The bar counts one more step, "완성". */
export const pos = (i: number) => `${i + 1}/${pc.assembly.length + 1}`;
