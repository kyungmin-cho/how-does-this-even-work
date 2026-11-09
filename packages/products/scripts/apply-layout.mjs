// Apply the Blender layout (packages/products/blender/pc_atx.layout.json) to data/pc_atx.json.
//
//   node packages/products/scripts/apply-layout.mjs
//
// Touches only: part.position, part.rotation, part.geometry.boxes (fallback + geometry tests),
// feature.position, and product.assets.glb. Assembly order, blocks, attachedTo, paths, mistakes,
// guides and views stay as they are. Idempotent. Run it again after `pnpm gen` (gen rewrites the file).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = join(here, "..", "data", "pc_atx.json");
const layoutPath = join(here, "..", "blender", "pc_atx.layout.json");

const product = JSON.parse(readFileSync(dataPath, "utf8"));
const layout = JSON.parse(readFileSync(layoutPath, "utf8"));

const missing = [];
for (const part of product.parts) {
  const l = layout.parts[part.id];
  if (!l) {
    missing.push(`part ${part.id}`);
    continue;
  }
  part.position = l.position;
  part.rotation = l.rotation;
  part.geometry = { kind: "boxes", boxes: l.boxes.map((b) => ({ size: b.size, position: b.position, color: b.color })) };
}
for (const f of product.features) {
  const l = layout.features[f.id];
  if (!l || l.partId !== f.partId) {
    missing.push(`feature ${f.id}`);
    continue;
  }
  f.position = l.position;
}
if (missing.length) {
  console.error(`layout has no entry for: ${missing.join(", ")}`);
  process.exit(1);
}

// Keep key order stable: put assets right after units.
const out = {};
for (const [k, v] of Object.entries(product)) {
  if (k === "assets") continue;
  out[k] = v;
  if (k === "units") out.assets = { glb: "/models/pc_atx.glb" };
}
writeFileSync(dataPath, JSON.stringify(out, null, 2) + "\n");
console.log(`applied layout: ${product.parts.length} parts, ${product.features.length} features, assets.glb set`);
