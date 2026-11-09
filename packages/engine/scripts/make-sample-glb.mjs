// Builds a small test GLB for the engine dev page (no Blender needed).
// Nodes: "gpu" (shroud, fans, backplate) and "Heatsink_M2" (fins). Units mm, Y-up,
// each node's origin = the part's local origin. Usage: node scripts/make-sample-glb.mjs <out.glb>
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const out = process.argv[2] ?? "sample-parts.glb";

const mats = [
  { name: "shroud", pbrMetallicRoughness: { baseColorFactor: [0.06, 0.065, 0.075, 1], metallicFactor: 0.4, roughnessFactor: 0.45 } },
  { name: "fan", pbrMetallicRoughness: { baseColorFactor: [0.12, 0.12, 0.13, 1], metallicFactor: 0.0, roughnessFactor: 0.7 } },
  { name: "backplate", pbrMetallicRoughness: { baseColorFactor: [0.55, 0.57, 0.6, 1], metallicFactor: 0.85, roughnessFactor: 0.32 } },
  { name: "accent", pbrMetallicRoughness: { baseColorFactor: [0.75, 0.12, 0.1, 1], metallicFactor: 0.2, roughnessFactor: 0.4 } },
  { name: "aluminum", pbrMetallicRoughness: { baseColorFactor: [0.72, 0.74, 0.77, 1], metallicFactor: 0.9, roughnessFactor: 0.3 } },
];
const M = Object.fromEntries(mats.map((m, i) => [m.name, i]));

const box = (sx, sy, sz, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
const disc = (r, h, x, y, z, seg = 40) => new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z); // axis = Y

function gpuParts() {
  const p = { shroud: [], fan: [], backplate: [], accent: [] };
  p.shroud.push(box(280, 34, 132, 0, -1, 0));
  for (const x of [-65, 65]) {
    p.shroud.push(disc(44, 2, x, -19, 0)); // fan ring
    p.fan.push(disc(41, 3, x, -19.5, 0));
    p.shroud.push(disc(14, 4, x, -20.5, 0)); // hub
    for (let i = 0; i < 9; i++) {
      const blade = box(34, 1.5, 9).translate(22, 0, 0).rotateY((i / 9) * Math.PI * 2).translate(x, -21, 0);
      p.fan.push(blade);
    }
  }
  p.backplate.push(box(280, 2, 132, 0, 17, 0));
  p.accent.push(box(240, 3, 6, 0, 0, 63.5));
  p.shroud.push(box(4, 40, 128, -142, 0, 0)); // bracket
  return p;
}

function heatsinkParts() {
  const p = { aluminum: [] };
  p.aluminum.push(box(84, 26, 2.5, 0, 0, -1.75));
  for (let i = 0; i < 12; i++) p.aluminum.push(box(2.4, 26, 5.5, -38 + i * 6.9, 0, 1.75));
  return p;
}

// ---- GLB writer ----
const chunks = [];
let offset = 0;
const json = { asset: { version: "2.0", generator: "assembly make-sample-glb" }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: mats, accessors: [], bufferViews: [], buffers: [] };

function addView(typed, target) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (bytes.length % 4)) % 4;
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  chunks.push(bytes, Buffer.alloc(pad));
  offset += bytes.length + pad;
  return json.bufferViews.length - 1;
}

function addAccessor(attr, type, target, withBounds) {
  const view = addView(attr, target);
  const comps = { VEC3: 3, SCALAR: 1 }[type];
  const acc = { bufferView: view, componentType: attr instanceof Float32Array ? 5126 : 5125, count: attr.length / comps, type };
  if (withBounds) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < attr.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], attr[i + k]);
      max[k] = Math.max(max[k], attr[i + k]);
    }
    Object.assign(acc, { min, max });
  }
  json.accessors.push(acc);
  return json.accessors.length - 1;
}

function addNode(name, groups, translation) {
  const primitives = [];
  for (const [mat, geos] of Object.entries(groups)) {
    const g = mergeGeometries(geos.map((x) => x.toNonIndexed()), false);
    g.computeVertexNormals();
    const pos = new Float32Array(g.attributes.position.array);
    const nor = new Float32Array(g.attributes.normal.array);
    const idx = new Uint32Array(pos.length / 3).map((_, i) => i);
    primitives.push({
      attributes: { POSITION: addAccessor(pos, "VEC3", 34962, true), NORMAL: addAccessor(nor, "VEC3", 34962, false) },
      indices: addAccessor(idx, "SCALAR", 34963, false),
      material: M[mat],
    });
  }
  json.meshes.push({ name, primitives });
  json.nodes.push({ name, mesh: json.meshes.length - 1, translation });
  json.scenes[0].nodes.push(json.nodes.length - 1);
}

// Translations are deliberately non-zero: the engine resets them (origin = part origin).
addNode("gpu", gpuParts(), [-22, 5, 88]);
addNode("Heatsink_M2", heatsinkParts(), [-60, 5, 16]);

const bin = Buffer.concat(chunks);
json.buffers.push({ byteLength: bin.length });
let jsonBuf = Buffer.from(JSON.stringify(json));
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(jsonBuf.length, 0);
jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(bin.length, 0);
bh.writeUInt32LE(0x004e4942, 4);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, jh, jsonBuf, bh, bin]));
console.log(`wrote ${out} (${(12 + 16 + jsonBuf.length + bin.length) / 1024 | 0} KB)`);
